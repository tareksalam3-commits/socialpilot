import { redirectToApp, serviceClient } from '../_shared/oauth.ts';
import { getCredentials } from '../_shared/credentials.ts';
import { consumeOAuthState } from '../_shared/genericOAuth2.ts';

async function exchangeCode(clientId: string, clientSecret: string | null, redirectUri: string, code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (clientSecret) {
    // Confidential client: authenticate with HTTP Basic per X's OAuth2 spec.
    headers['Authorization'] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
  } else {
    // Public client (PKCE-only, no secret registered): client_id travels in the body.
    body.set('client_id', clientId);
  }
  const res = await fetch('https://api.twitter.com/2/oauth2/token', { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
}

async function fetchProfile(accessToken: string) {
  const res = await fetch('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`profile fetch failed: ${await res.text()}`);
  const body = await res.json();
  return body.data as { id: string; username: string; name: string };
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');

  if (oauthError) return await redirectToApp(supabase, { platform: 'x', error: oauthError });
  if (!code || !state) return await redirectToApp(supabase, { platform: 'x', error: 'missing_code_or_state' });

  const creds = await getCredentials(supabase, ['x_client_id', 'x_client_secret']);
  if (!creds.x_client_id) return await redirectToApp(supabase, { platform: 'x', error: 'server_not_configured' });

  const consumed = await consumeOAuthState(supabase, 'x', state);
  if (!consumed || !consumed.code_verifier) return await redirectToApp(supabase, { platform: 'x', error: 'invalid_or_expired_state' });

  const functionsUrl = Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.supabase.co/functions/v1');
  const redirectUri = `${functionsUrl}/x-oauth-callback`;

  try {
    const token = await exchangeCode(creds.x_client_id, creds.x_client_secret, redirectUri, code, consumed.code_verifier);
    const profile = await fetchProfile(token.access_token);
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    // X returns exactly one authenticated account — no Page/Org picker needed,
    // so we connect it straight away instead of routing through
    // oauth_pending_selections like Meta/LinkedIn do.
    const { error } = await supabase.from('connected_accounts').upsert(
      {
        workspace_id: consumed.workspace_id,
        platform: 'x',
        handle: `@${profile.username}`,
        provider_account_id: profile.id,
        access_token_encrypted: token.access_token,
        refresh_token_encrypted: token.refresh_token ?? null,
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

    return await redirectToApp(supabase, { platform: 'x', connected: '1' });
  } catch (e) {
    return await redirectToApp(supabase, { platform: 'x', error: e instanceof Error ? e.message : 'unknown_error' });
  }
});
