import { corsHeadersFor, errorResponse, getCallerId, jsonResponse, randomState, serviceClient } from '../_shared/oauth.ts';
import { getCredential } from '../_shared/credentials.ts';

// `r_organization_social`/`w_organization_social`/`rw_organization_admin` require
// LinkedIn's Community Management API product to be approved on the app;
// without it, only the personal profile scopes below will work.
const LINKEDIN_SCOPES = [
  'openid',
  'profile',
  'email',
  'w_member_social',
].join(' ');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const functionsUrl = Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.supabase.co/functions/v1');
  const supabase = serviceClient();
  const clientId = await getCredential(supabase, 'linkedin_client_id');
  if (!clientId) return errorResponse('LinkedIn Client ID is not configured. Set it in Settings > Integrations.', 500);

  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  const { workspace_id } = await req.json().catch(() => ({}));
  if (!workspace_id) return errorResponse('workspace_id is required', 400);

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspace_id)
    .eq('user_id', callerId)
    .maybeSingle();
  if (!membership) return errorResponse('Forbidden', 403);

  const state = randomState();
  const { error } = await supabase.from('oauth_states').insert({
    state,
    workspace_id,
    user_id: callerId,
    platform: 'linkedin',
  });
  if (error) return errorResponse('Could not start OAuth flow', 500);

  const redirectUri = `${functionsUrl}/linkedin-oauth-callback`;
  const authorizeUrl = new URL('https://www.linkedin.com/oauth/v2/authorization');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('scope', LINKEDIN_SCOPES);

  return jsonResponse({ url: authorizeUrl.toString() });
});
