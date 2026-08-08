import { redirectToApp, serviceClient } from '../_shared/oauth.ts';
import { getCredentials } from '../_shared/credentials.ts';
import { consumeOAuthState } from '../_shared/genericOAuth2.ts';

const GRAPH = 'https://graph.threads.net';

async function exchangeShortLivedCode(clientId: string, clientSecret: string, redirectUri: string, code: string) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token`, { method: 'POST', body });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; user_id: string };
}

/** Short-lived Threads tokens last ~1 hour; exchanging for a long-lived token
 * (~60 days, and itself refreshable) up front means the account doesn't need
 * reconnecting the same day it was connected. */
async function exchangeForLongLivedToken(clientSecret: string, shortLivedToken: string) {
  const url = new URL(`${GRAPH}/access_token`);
  url.searchParams.set('grant_type', 'th_exchange_token');
  url.searchParams.set('client_secret', clientSecret);
  url.searchParams.set('access_token', shortLivedToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`long-lived token exchange failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number };
}

async function fetchProfile(accessToken: string) {
  // Threads only allows fetching the profile of the app-scoped user tied to
  // the access token — /me is the documented way to address it. Using the
  // raw numeric user_id returned from the token exchange can trigger a
  // "does not exist / missing permissions" error (code 100, subcode 33)
  // even though the token itself is valid.
  const url = new URL(`${GRAPH}/v1.0/me`);
  url.searchParams.set('fields', 'id,username');
  url.searchParams.set('access_token', accessToken);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`profile fetch failed: ${await res.text()}`);
  return (await res.json()) as { id: string; username: string };
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');

  if (oauthError) return await redirectToApp(supabase, { platform: 'threads', error: oauthError });
  if (!code || !state) return await redirectToApp(supabase, { platform: 'threads', error: 'missing_code_or_state' });

  const creds = await getCredentials(supabase, ['threads_app_id', 'threads_app_secret']);
  if (!creds.threads_app_id || !creds.threads_app_secret) return await redirectToApp(supabase, { platform: 'threads', error: 'server_not_configured' });

  const consumed = await consumeOAuthState(supabase, 'threads', state);
  if (!consumed) return await redirectToApp(supabase, { platform: 'threads', error: 'invalid_or_expired_state' });

  const functionsUrl = Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.supabase.co/functions/v1');
  const redirectUri = `${functionsUrl}/threads-oauth-callback`;

  try {
    const shortLived = await exchangeShortLivedCode(creds.threads_app_id, creds.threads_app_secret, redirectUri, code);
    const longLived = await exchangeForLongLivedToken(creds.threads_app_secret, shortLived.access_token);
    const profile = await fetchProfile(longLived.access_token);
    const expiresAt = new Date(Date.now() + longLived.expires_in * 1000).toISOString();

    const { error } = await supabase.from('connected_accounts').upsert(
      {
        workspace_id: consumed.workspace_id,
        platform: 'threads',
        handle: `@${profile.username}`,
        provider_account_id: profile.id,
        access_token_encrypted: longLived.access_token,
        refresh_token_encrypted: null, // Threads has no separate refresh token — the long-lived access token itself is refreshed in place (see threadsRefresh.ts).
        token_expires_at: expiresAt,
        status: 'connected',
        sync_status: 'synced',
        health_status: 'healthy',
        last_synced_at: new Date().toISOString(),
        metadata: { connected_by: consumed.user_id },
      },
      { onConflict: 'workspace_id,platform,provider_account_id', ignoreDuplicates: false },
    );
    if (error) throw new Error(error.message);

    return await redirectToApp(supabase, { platform: 'threads', connected: '1' });
  } catch (e) {
    return await redirectToApp(supabase, { platform: 'threads', error: e instanceof Error ? e.message : 'unknown_error' });
  }
});
