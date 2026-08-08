import { redirectToApp, serviceClient } from '../_shared/oauth.ts';
import { getCredentials } from '../_shared/credentials.ts';
import { consumeOAuthState } from '../_shared/genericOAuth2.ts';

async function exchangeCode(clientKey: string, clientSecret: string, redirectUri: string, code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body,
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`[tiktok-oauth-callback] token exchange failed (HTTP ${res.status}): ${detail}`);
    // TikTok's token error bodies are JSON like { error, error_description }.
    // Try to surface the human-readable description; fall back to raw text.
    let parsed: { error_description?: string; error?: string } | null = null;
    try {
      parsed = JSON.parse(detail);
    } catch {
      parsed = null;
    }
    const message = parsed?.error_description || parsed?.error || `token exchange failed (HTTP ${res.status}): ${detail.slice(0, 300)}`;
    throw new Error(message);
  }
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number; open_id: string };
}

async function fetchProfile(accessToken: string) {
  const url = new URL('https://open.tiktokapis.com/v2/user/info/');
  url.searchParams.set('fields', 'open_id,display_name');
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`[tiktok-oauth-callback] profile fetch failed (HTTP ${res.status}): ${detail}`);
    throw new Error(`profile fetch failed (HTTP ${res.status}): ${detail.slice(0, 300)}`);
  }
  const body = await res.json();
  if (!body?.data?.user) {
    console.error(`[tiktok-oauth-callback] profile response had no data.user: ${JSON.stringify(body)}`);
    throw new Error('profile fetch returned an unexpected shape');
  }
  return body.data.user as { open_id: string; display_name: string };
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');

  if (oauthError) {
    console.error(`[tiktok-oauth-callback] TikTok returned an OAuth error: ${oauthError}`);
    return await redirectToApp(supabase, { platform: 'tiktok', error: oauthError });
  }
  if (!code || !state) {
    console.error(`[tiktok-oauth-callback] missing code or state in callback URL: ${req.url}`);
    return await redirectToApp(supabase, { platform: 'tiktok', error: 'missing_code_or_state' });
  }

  const creds = await getCredentials(supabase, ['tiktok_client_key', 'tiktok_client_secret']);
  if (!creds.tiktok_client_key || !creds.tiktok_client_secret) {
    console.error('[tiktok-oauth-callback] tiktok_client_key/tiktok_client_secret not configured (Settings > Integrations or TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET env vars)');
    return await redirectToApp(supabase, { platform: 'tiktok', error: 'server_not_configured' });
  }

  const consumed = await consumeOAuthState(supabase, 'tiktok', state);
  if (!consumed || !consumed.code_verifier) {
    console.error(`[tiktok-oauth-callback] invalid, expired, or already-consumed state (or missing code_verifier): ${state}`);
    return await redirectToApp(supabase, { platform: 'tiktok', error: 'invalid_or_expired_state' });
  }

  const functionsUrl = Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.supabase.co/functions/v1');
  const redirectUri = `${functionsUrl}/tiktok-oauth-callback`;

  try {
    const token = await exchangeCode(creds.tiktok_client_key, creds.tiktok_client_secret, redirectUri, code, consumed.code_verifier);
    const profile = await fetchProfile(token.access_token);
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();

    const { error } = await supabase.from('connected_accounts').upsert(
      {
        workspace_id: consumed.workspace_id,
        platform: 'tiktok',
        handle: profile.display_name,
        provider_account_id: profile.open_id,
        access_token_encrypted: token.access_token,
        refresh_token_encrypted: token.refresh_token,
        token_expires_at: expiresAt,
        status: 'connected',
        sync_status: 'synced',
        health_status: 'healthy',
        last_synced_at: new Date().toISOString(),
        // TikTok's Content Posting API restricts unaudited apps to private/
        // self-view publishing — surfaced on the Accounts card so it isn't a
        // surprise the first time a scheduled post "publishes" but stays
        // invisible to followers until the app passes review.
        metadata: { connected_by: consumed.user_id, refresh_token_expires_at: new Date(Date.now() + token.refresh_expires_in * 1000).toISOString() },
      },
      { onConflict: 'workspace_id,platform,provider_account_id', ignoreDuplicates: false },
    );
    if (error) {
      console.error(`[tiktok-oauth-callback] connected_accounts upsert failed: ${error.message}`);
      throw new Error(error.message);
    }

    return await redirectToApp(supabase, { platform: 'tiktok', connected: '1' });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown_error';
    console.error(`[tiktok-oauth-callback] connect flow failed: ${message}`);
    // Cap the length so an unusually verbose upstream error can't blow past
    // typical URL/redirect length limits — the full detail is still in the logs above.
    return await redirectToApp(supabase, { platform: 'tiktok', error: message.slice(0, 300) });
  }
});
