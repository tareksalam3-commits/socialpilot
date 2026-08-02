import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getCredentials } from './credentials.ts';

/** How far ahead of expiry we proactively refresh a LinkedIn token during the
 * cron sweep. LinkedIn access tokens last ~60 days; refreshing with 10 days
 * of headroom leaves plenty of margin for a missed cron run. */
const REFRESH_WINDOW_DAYS = 10;

type ConnectedAccountRow = {
  id: string;
  workspace_id: string;
  platform: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  metadata: Record<string, unknown> | null;
};

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`LinkedIn token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
  };
}

export type LinkedInRefreshResult = {
  refreshed: number;
  failed: number;
  skipped: number;
  details: Array<{ account_id: string; ok: boolean; error?: string }>;
};

/** Refreshes LinkedIn (personal + company Page) access tokens using the
 * stored refresh_token. Requires the app to have LinkedIn's "Programmatic
 * Refresh Tokens" product enabled — without it no refresh_token is ever
 * issued at connect time, and those accounts are skipped here (they'll show
 * up as "warning" once close to expiry via the account-health sweep, and
 * need to be reconnected manually through OAuth).
 *
 * Pass `accountId` to force-refresh one specific account (manual "Refresh
 * Token" button); omit it to sweep every LinkedIn account nearing expiry
 * (cron scheduler). */
export async function refreshLinkedInTokens(supabase: SupabaseClient, opts: { accountId?: string } = {}): Promise<LinkedInRefreshResult> {
  const creds = await getCredentials(supabase, ['linkedin_client_id', 'linkedin_client_secret']);
  const clientId = creds.linkedin_client_id;
  const clientSecret = creds.linkedin_client_secret;
  const result: LinkedInRefreshResult = { refreshed: 0, failed: 0, skipped: 0, details: [] };

  if (!clientId || !clientSecret) {
    result.details.push({ account_id: opts.accountId ?? 'n/a', ok: false, error: 'LinkedIn Client ID/Secret not configured' });
    return result;
  }

  let query = supabase
    .from('connected_accounts')
    .select('id, workspace_id, platform, access_token_encrypted, refresh_token_encrypted, metadata')
    .in('platform', ['linkedin', 'linkedin_page'])
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
    if (!account.refresh_token_encrypted) {
      result.skipped++;
      result.details.push({ account_id: account.id, ok: false, error: 'No refresh token on file — reconnect via LinkedIn login' });
      continue;
    }

    try {
      const refreshed = await refreshAccessToken(clientId, clientSecret, account.refresh_token_encrypted);
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

      await supabase
        .from('connected_accounts')
        .update({
          access_token_encrypted: refreshed.access_token,
          // LinkedIn may or may not rotate the refresh token on each use —
          // keep the existing one if a new one wasn't returned.
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
