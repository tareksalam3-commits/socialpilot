import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { errorResponse, getCallerId, jsonResponse, randomState } from './oauth.ts';
import { getCredential } from './credentials.ts';
import { generateCodeVerifier, codeChallengeFromVerifier } from './pkce.ts';

export type OAuth2ConnectConfig = {
  platform: 'x' | 'threads' | 'tiktok';
  clientIdCredentialKey: string;
  clientIdMissingMessage: string;
  authorizeUrl: string;
  /** Query param name the provider expects for the client id ('client_id' for
   * most, but TikTok calls it 'client_key'). */
  clientIdParam: string;
  scope: string;
  scopeParam?: string; // defaults to 'scope'
  usesPkce: boolean;
  redirectUriFunctionName: string; // e.g. 'x-oauth-callback'
  extraAuthorizeParams?: Record<string, string>;
};

/** Starts a redirect-based OAuth2 flow: checks the caller belongs to the
 * workspace, stores a CSRF state row (plus a PKCE verifier when required),
 * and returns the provider's authorize URL for the frontend to redirect to.
 * Shared by x-oauth-connect, threads-oauth-connect, and tiktok-oauth-connect
 * so the CSRF/PKCE bookkeeping isn't reimplemented three times. */
export async function startOAuth2Connect(supabase: SupabaseClient, req: Request, config: OAuth2ConnectConfig): Promise<Response> {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const clientId = await getCredential(supabase, config.clientIdCredentialKey);
  if (!clientId) {
    console.error(`[${config.platform}-oauth-connect] ${config.clientIdMissingMessage}`);
    return errorResponse(config.clientIdMissingMessage, 500);
  }

  const callerId = await getCallerId(supabase, req);
  if (!callerId) {
    console.error(`[${config.platform}-oauth-connect] Unauthorized: missing or invalid bearer token`);
    return errorResponse('Unauthorized', 401);
  }

  const { workspace_id } = await req.json().catch(() => ({}));
  if (!workspace_id) {
    console.error(`[${config.platform}-oauth-connect] workspace_id missing from request body`);
    return errorResponse('workspace_id is required', 400);
  }

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspace_id)
    .eq('user_id', callerId)
    .maybeSingle();
  if (!membership) {
    console.error(`[${config.platform}-oauth-connect] Forbidden: user ${callerId} is not a member of workspace ${workspace_id}`);
    return errorResponse('Forbidden', 403);
  }

  const state = randomState();
  const codeVerifier = config.usesPkce ? generateCodeVerifier() : null;

  const { error } = await supabase.from('oauth_states').insert({
    state,
    workspace_id,
    user_id: callerId,
    platform: config.platform,
    code_verifier: codeVerifier,
  });
  // Surface the actual DB error (e.g. a stale platform CHECK constraint, or a
  // missing oauth_states.code_verifier column) instead of a generic message —
  // this is what used to show up to the user as an opaque "non-2xx" toast.
  if (error) {
    console.error(`[${config.platform}-oauth-connect] oauth_states insert failed: ${error.message}`);
    return errorResponse(`Could not start OAuth flow: ${error.message}`, 500);
  }

  const functionsUrl = Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.supabase.co/functions/v1');
  const redirectUri = `${functionsUrl}/${config.redirectUriFunctionName}`;

  const authorizeUrl = new URL(config.authorizeUrl);
  authorizeUrl.searchParams.set(config.clientIdParam, clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set(config.scopeParam ?? 'scope', config.scope);
  if (config.usesPkce && codeVerifier) {
    authorizeUrl.searchParams.set('code_challenge', await codeChallengeFromVerifier(codeVerifier));
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  }
  for (const [key, value] of Object.entries(config.extraAuthorizeParams ?? {})) {
    authorizeUrl.searchParams.set(key, value);
  }

  return jsonResponse({ url: authorizeUrl.toString() });
}

export type ConsumedState = { workspace_id: string; user_id: string; code_verifier: string | null };

/** Validates and deletes an OAuth CSRF state row, returning the workspace/user
 * it was issued for (and PKCE verifier, if any). Shared by every callback. */
export async function consumeOAuthState(supabase: SupabaseClient, platform: string, state: string | null): Promise<ConsumedState | null> {
  if (!state) return null;
  const { data: stateRow } = await supabase.from('oauth_states').select('*').eq('state', state).eq('platform', platform).maybeSingle();
  if (!stateRow || new Date(stateRow.expires_at as string) < new Date()) return null;
  await supabase.from('oauth_states').delete().eq('id', stateRow.id as string);
  return {
    workspace_id: stateRow.workspace_id as string,
    user_id: stateRow.user_id as string,
    code_verifier: (stateRow.code_verifier as string | null) ?? null,
  };
}
