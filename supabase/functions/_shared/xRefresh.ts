import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getCredentials } from './credentials.ts';

/** X access tokens last ~2 hours — refresh with a wide 6-hour window so a
 * missed cron tick or two never leaves a scheduled post stranded. */
const REFRESH_WINDOW_HOURS = 6;

type ConnectedAccountRow = {
  id: string;
  workspace_id: string;
  refresh_token_encrypted: string | null;
  metadata: Record<string, unknown> | null;
};

async function refreshAccessToken(clientId: string, clientSecret: string | null, refreshToken: string) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (clientSecret) {
    headers['Authorization'] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  } else {
    body.set('client_id', clientId);
  }
  const res = await fetch('https://api.twitter.com/2/oauth2/token', { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`X token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
}

export type XRefreshResult = { refreshed: number; failed: number; details: Array<{ account_id: string; ok: boolean; error?: string }> };

/** Refreshes X access tokens using the stored refresh_token (issued because
 * the connect flow requests the `offline.access` scope). Pass `accountId` to
 * force one account (manual "Refresh Token" button); omit to sweep every X
 * account nearing expiry (cron scheduler). */
export async function refreshXTokens(supabase: SupabaseClient, opts: { accountId?: string } = {}): Promise<XRefreshResult> {
  const creds = await getCredentials(supabase, ['x_client_id', 'x_client_secret']);
  const result: XRefreshResult = { refreshed: 0, failed: 0, details: [] };

  if (!creds.x_client_id) {
    result.details.push({ account_id: opts.accountId ?? 'n/a', ok: false, error: 'X Client ID not configured' });
    return result;
  }

  let query = supabase
    .from('connected_accounts')
    .select('id, workspace_id, refresh_token_encrypted, metadata')
    .eq('platform', 'x')
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
      result.details.push({ account_id: account.id, ok: false, error: 'No refresh token on file — reconnect via X login' });
      continue;
    }
    try {
      const refreshed = await refreshAccessToken(creds.x_client_id, creds.x_client_secret, account.refresh_token_encrypted);
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await supabase
        .from('connected_accounts')
        .update({
          access_token_encrypted: refreshed.access_token,
          // X rotates refresh tokens on every use — the old one becomes invalid.
          refresh_token_encrypted: refreshed.refresh_token ?? account.refresh_token_encrypted,
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
