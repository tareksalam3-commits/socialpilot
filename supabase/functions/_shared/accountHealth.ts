import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getCredentials } from './credentials.ts';
import { syncInboundAccount } from './inboundSync.ts';

const GRAPH = 'https://graph.facebook.com/v21.0';

type AccountRow = {
  id: string;
  workspace_id: string;
  platform: string;
  handle: string | null;
  provider_account_id: string | null;
  access_token_encrypted: string | null;
  token_expires_at: string | null;
  metadata: Record<string, unknown> | null;
};

export type HealthCheckOutcome = {
  ok: boolean;
  health_status: 'healthy' | 'warning' | 'error';
  handle?: string;
  error?: string;
  inbound?: Awaited<ReturnType<typeof syncInboundAccount>>;
};

/** Verifies a Facebook Page or Instagram Business token is still valid by
 * asking the Graph API for the account's own id (the cheapest authenticated
 * call available) and picks up the current name/username while at it, so a
 * rename on the platform side is reflected without a full reconnect. */
async function checkMetaAccount(account: AccountRow): Promise<HealthCheckOutcome> {
  if (!account.access_token_encrypted) return { ok: false, health_status: 'error', error: 'No access token stored' };
  const fields = account.platform === 'instagram' ? 'id,username' : 'id,name';
  const url = new URL(`${GRAPH}/${account.provider_account_id}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', account.access_token_encrypted);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error?.message ?? `${res.status} ${res.statusText}`;
    // Meta's OAuthException error code 190 = expired/invalid token.
    const expired = body?.error?.code === 190;
    return { ok: false, health_status: expired ? 'error' : 'warning', error: message };
  }
  const body = await res.json();
  const handle = account.platform === 'instagram' ? (body.username ? `@${body.username}` : undefined) : body.name;
  return { ok: true, health_status: 'healthy', handle };
}

/** Verifies a LinkedIn token (personal or Company Page) using LinkedIn's
 * standard OAuth 2.0 Token Introspection endpoint — works for any token type
 * without needing extra scopes, and reports the token's real expiry so we
 * can keep `token_expires_at` accurate even if it drifts from our estimate. */
async function checkLinkedInAccount(
  supabase: SupabaseClient,
  account: AccountRow,
): Promise<HealthCheckOutcome & { expires_at?: string }> {
  if (!account.access_token_encrypted) return { ok: false, health_status: 'error', error: 'No access token stored' };

  const creds = await getCredentials(supabase, ['linkedin_client_id', 'linkedin_client_secret']);
  if (!creds.linkedin_client_id || !creds.linkedin_client_secret) {
    return { ok: false, health_status: 'warning', error: 'LinkedIn Client ID/Secret not configured' };
  }

  const body = new URLSearchParams({
    token: account.access_token_encrypted,
    client_id: creds.linkedin_client_id,
    client_secret: creds.linkedin_client_secret,
  });
  const res = await fetch('https://www.linkedin.com/oauth/v2/introspectToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return { ok: false, health_status: 'warning', error: `Introspection failed: ${res.status}` };

  const data = await res.json();
  if (!data.active) return { ok: false, health_status: 'error', error: 'Token is no longer active' };

  return {
    ok: true,
    health_status: 'healthy',
    expires_at: data.expires_at ? new Date(data.expires_at * 1000).toISOString() : undefined,
  };
}

/** Verifies an X access token by asking for the authenticated user's own
 * profile — the cheapest authenticated v2 call available. */
async function checkXAccount(account: AccountRow): Promise<HealthCheckOutcome> {
  if (!account.access_token_encrypted) return { ok: false, health_status: 'error', error: 'No access token stored' };
  const res = await fetch('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${account.access_token_encrypted}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, health_status: res.status === 401 ? 'error' : 'warning', error: body?.detail ?? body?.title ?? `${res.status} ${res.statusText}` };
  }
  const body = await res.json();
  return { ok: true, health_status: 'healthy', handle: body.data?.username ? `@${body.data.username}` : undefined };
}

async function checkThreadsAccount(account: AccountRow): Promise<HealthCheckOutcome> {
  if (!account.access_token_encrypted) return { ok: false, health_status: 'error', error: 'No access token stored' };
  const url = new URL(`https://graph.threads.net/v1.0/${account.provider_account_id}`);
  url.searchParams.set('fields', 'id,username');
  url.searchParams.set('access_token', account.access_token_encrypted);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return { ok: false, health_status: body?.error?.code === 190 ? 'error' : 'warning', error: body?.error?.message ?? `${res.status} ${res.statusText}` };
  }
  const body = await res.json();
  return { ok: true, health_status: 'healthy', handle: body.username ? `@${body.username}` : undefined };
}

async function checkTikTokAccount(account: AccountRow): Promise<HealthCheckOutcome> {
  if (!account.access_token_encrypted) return { ok: false, health_status: 'error', error: 'No access token stored' };
  const url = new URL('https://open.tiktokapis.com/v2/user/info/');
  url.searchParams.set('fields', 'display_name');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${account.access_token_encrypted}` } });
  const body = await res.json();
  if (!res.ok || body.error?.code !== 'ok') {
    return { ok: false, health_status: 'warning', error: body?.error?.message ?? `${res.status} ${res.statusText}` };
  }
  return { ok: true, health_status: 'healthy', handle: body.data?.user?.display_name };
}

/** Telegram bot tokens don't expire, so "health" here just confirms the bot
 * can still reach the target chat (it may have been removed as admin, kicked,
 * or the chat deleted since connecting). */
async function checkTelegramAccount(account: AccountRow): Promise<HealthCheckOutcome> {
  if (!account.access_token_encrypted) return { ok: false, health_status: 'error', error: 'No bot token stored' };
  const res = await fetch(`https://api.telegram.org/bot${account.access_token_encrypted}/getChat?chat_id=${encodeURIComponent(account.provider_account_id ?? '')}`);
  const body = await res.json();
  if (!body.ok) return { ok: false, health_status: 'error', error: body.description ?? 'Bot can no longer access this chat' };
  return { ok: true, health_status: 'healthy', handle: body.result.username ? `@${body.result.username}` : body.result.title };
}

async function checkWhatsAppAccount(account: AccountRow): Promise<HealthCheckOutcome> {
  if (!account.access_token_encrypted) return { ok: false, health_status: 'error', error: 'No access token stored' };
  const url = new URL(`${GRAPH}/${account.provider_account_id}`);
  url.searchParams.set('fields', 'verified_name,display_phone_number,quality_rating');
  url.searchParams.set('access_token', account.access_token_encrypted);
  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok) return { ok: false, health_status: body?.error?.code === 190 ? 'error' : 'warning', error: body?.error?.message ?? `${res.status} ${res.statusText}` };
  return { ok: true, health_status: 'healthy', handle: body.verified_name ?? body.display_phone_number };
}

/** Runs the platform-appropriate health check for one connected account and
 * persists the result (health_status, sync_status, last_synced_at, and any
 * refreshed handle/expiry we learned along the way). Used by both the
 * manual "Sync" button (account-sync edge function) and the cron sweep. */
export async function syncAccount(supabase: SupabaseClient, account: AccountRow): Promise<HealthCheckOutcome> {
  await supabase.from('connected_accounts').update({ sync_status: 'syncing', updated_at: new Date().toISOString() }).eq('id', account.id);

  let outcome: HealthCheckOutcome & { expires_at?: string };
  try {
    if (account.platform === 'facebook' || account.platform === 'instagram') {
      outcome = await checkMetaAccount(account);
    } else if (account.platform === 'linkedin' || account.platform === 'linkedin_page') {
      outcome = await checkLinkedInAccount(supabase, account);
    } else if (account.platform === 'x') {
      outcome = await checkXAccount(account);
    } else if (account.platform === 'threads') {
      outcome = await checkThreadsAccount(account);
    } else if (account.platform === 'tiktok') {
      outcome = await checkTikTokAccount(account);
    } else if (account.platform === 'telegram') {
      outcome = await checkTelegramAccount(account);
    } else if (account.platform === 'whatsapp') {
      outcome = await checkWhatsAppAccount(account);
    } else {
      outcome = { ok: false, health_status: 'warning', error: `Unsupported platform: ${account.platform}` };
    }
  } catch (e) {
    outcome = { ok: false, health_status: 'warning', error: e instanceof Error ? e.message : 'Unknown error' };
  }

  if (outcome.ok) {
    try {
      outcome.inbound = await syncInboundAccount(supabase, account);
      if (outcome.inbound.warnings.length > 0 && outcome.health_status === 'healthy') {
        outcome.health_status = 'warning';
      }
    } catch (error) {
      outcome.health_status = 'warning';
      outcome.inbound = {
        platform: account.platform,
        posts: 0,
        analytics: 0,
        conversations: 0,
        messages: 0,
        skipped: 0,
        warnings: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  await supabase
    .from('connected_accounts')
    .update({
      health_status: outcome.health_status,
      sync_status: outcome.ok ? 'synced' : 'error',
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(outcome.handle ? { handle: outcome.handle } : {}),
      ...(outcome.expires_at ? { token_expires_at: outcome.expires_at } : {}),
      ...((!outcome.ok || (outcome.inbound?.warnings.length ?? 0) > 0)
        ? { metadata: { ...(account.metadata ?? {}), last_sync_error: outcome.error ?? outcome.inbound?.warnings.join('; '), last_sync_error_at: new Date().toISOString(), last_inbound_sync: outcome.inbound ?? null } }
        : { metadata: { ...(account.metadata ?? {}), last_inbound_sync: outcome.inbound ?? null } }),
    })
    .eq('id', account.id);

  return outcome;
}

/** Background sweep (run from the cron scheduler): for any connected
 * account whose token has already expired or is about to, without an
 * automatic silent-refresh path (LinkedIn accounts with no refresh_token on
 * file), flags it 'warning'/'error' so the Connected Accounts page surfaces
 * it before a scheduled post silently fails. Meta accounts are excluded
 * here since refreshMetaTokens already keeps their status current. */
export async function flagExpiringLinkedInAccounts(supabase: SupabaseClient): Promise<void> {
  const now = new Date();
  const warnCutoff = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows } = await supabase
    .from('connected_accounts')
    .select('id, token_expires_at, refresh_token_encrypted, health_status')
    .in('platform', ['linkedin', 'linkedin_page'])
    .eq('status', 'connected')
    .is('refresh_token_encrypted', null)
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', warnCutoff);

  for (const row of rows ?? []) {
    const expired = new Date(row.token_expires_at as string) < now;
    const nextStatus = expired ? 'error' : 'warning';
    if (row.health_status === nextStatus) continue;
    await supabase
      .from('connected_accounts')
      .update({ health_status: nextStatus, updated_at: new Date().toISOString() })
      .eq('id', row.id as string);
  }
}
