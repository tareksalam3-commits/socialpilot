import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getCredentials } from './credentials.ts';

/** TikTok access tokens last ~24 hours — refresh with a generous 12-hour
 * window so a missed cron tick doesn't strand a scheduled post. */
const REFRESH_WINDOW_HOURS = 12;

type ConnectedAccountRow = { id: string; workspace_id: string; refresh_token_encrypted: string | null; metadata: Record<string, unknown> | null };

async function refreshAccessToken(clientKey: string, clientSecret: string, refreshToken: string) {
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body,
  });
  if (!res.ok) throw new Error(`TikTok token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number };
}

export type TikTokRefreshResult = { refreshed: number; failed: number; details: Array<{ account_id: string; ok: boolean; error?: string }> };

export async function refreshTikTokTokens(supabase: SupabaseClient, opts: { accountId?: string } = {}): Promise<TikTokRefreshResult> {
  const creds = await getCredentials(supabase, ['tiktok_client_key', 'tiktok_client_secret']);
  const result: TikTokRefreshResult = { refreshed: 0, failed: 0, details: [] };

  if (!creds.tiktok_client_key || !creds.tiktok_client_secret) {
    result.details.push({ account_id: opts.accountId ?? 'n/a', ok: false, error: 'TikTok Client Key/Secret not configured' });
    return result;
  }

  let query = supabase
    .from('connected_accounts')
    .select('id, workspace_id, refresh_token_encrypted, metadata')
    .eq('platform', 'tiktok')
    .eq('status', 'connected');

  if (opts.accountId) {
    query = query.eq('id', opts.accountId);
  } else {
    const cutoff = new Date(Date.now() + REFRESH_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    query = query.not('token_expires_at', 'is', null).lte('token_expires_at', cutoff);
  }

  const { data: rows, error: fetchError } = await query;
  if (fetchError) {
    result.details.push({ account_id: opts.accountId ?? 'n/a', ok: false, error: fetchError.message });
    return result;
  }

  for (const account of (rows ?? []) as ConnectedAccountRow[]) {
    if (!account.refresh_token_encrypted) {
      result.failed++;
      result.details.push({ account_id: account.id, ok: false, error: 'No refresh token on file — reconnect via TikTok login' });
      continue;
    }
    try {
      const refreshed = await refreshAccessToken(creds.tiktok_client_key, creds.tiktok_client_secret, account.refresh_token_encrypted);
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await supabase
        .from('connected_accounts')
        .update({
          access_token_encrypted: refreshed.access_token,
          refresh_token_encrypted: refreshed.refresh_token,
          token_expires_at: newExpiresAt,
          health_status: 'healthy',
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          metadata: { ...(account.metadata ?? {}), refresh_token_expires_at: new Date(Date.now() + refreshed.refresh_expires_in * 1000).toISOString() },
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
