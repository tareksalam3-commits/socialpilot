import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getCredentials } from './credentials.ts';

/** Threads long-lived tokens last ~60 days; refresh with 10 days of headroom. */
const REFRESH_WINDOW_DAYS = 10;

type ConnectedAccountRow = { id: string; workspace_id: string; access_token_encrypted: string | null; metadata: Record<string, unknown> | null };

async function refreshLongLivedToken(clientSecret: string, currentToken: string) {
  const url = new URL('https://graph.threads.net/refresh_access_token');
  url.searchParams.set('grant_type', 'th_refresh_token');
  url.searchParams.set('access_token', currentToken);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${clientSecret}` } });
  if (!res.ok) throw new Error(`Threads token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number };
}

export type ThreadsRefreshResult = { refreshed: number; failed: number; details: Array<{ account_id: string; ok: boolean; error?: string }> };

/** Threads has no separate refresh_token — the long-lived access token is
 * refreshed in place using itself, which is why (unlike LinkedIn/X) there's
 * no "skipped, no refresh token on file" case: as long as the account is
 * connected at all, refreshing is always possible. */
export async function refreshThreadsTokens(supabase: SupabaseClient, opts: { accountId?: string } = {}): Promise<ThreadsRefreshResult> {
  const creds = await getCredentials(supabase, ['threads_app_secret']);
  const result: ThreadsRefreshResult = { refreshed: 0, failed: 0, details: [] };

  if (!creds.threads_app_secret) {
    result.details.push({ account_id: opts.accountId ?? 'n/a', ok: false, error: 'Threads App Secret not configured' });
    return result;
  }

  let query = supabase
    .from('connected_accounts')
    .select('id, workspace_id, access_token_encrypted, metadata')
    .eq('platform', 'threads')
    .eq('status', 'connected');

  if (opts.accountId) {
    query = query.eq('id', opts.accountId);
  } else {
    const cutoff = new Date(Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    query = query.not('token_expires_at', 'is', null).lte('token_expires_at', cutoff);
  }

  const { data: rows, error: fetchError } = await query;
  if (fetchError) {
    result.details.push({ account_id: opts.accountId ?? 'n/a', ok: false, error: fetchError.message });
    return result;
  }

  for (const account of (rows ?? []) as ConnectedAccountRow[]) {
    if (!account.access_token_encrypted) {
      result.failed++;
      result.details.push({ account_id: account.id, ok: false, error: 'No access token on file — reconnect via Threads login' });
      continue;
    }
    try {
      const refreshed = await refreshLongLivedToken(creds.threads_app_secret, account.access_token_encrypted);
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await supabase
        .from('connected_accounts')
        .update({
          access_token_encrypted: refreshed.access_token,
          token_expires_at: newExpiresAt,
          health_status: 'healthy',
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);
      result.refreshed++;
      result.details.push({ account_id: account.id, ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      await supabase
        .from('connected_accounts')
        .update({
          health_status: 'error',
          sync_status: 'error',
          metadata: { ...(account.metadata ?? {}), last_refresh_error: message, last_refresh_error_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);
      result.failed++;
      result.details.push({ account_id: account.id, ok: false, error: message });
    }
  }

  return result;
}
