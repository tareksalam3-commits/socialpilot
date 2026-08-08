import { corsHeaders, serviceClient } from '../_shared/oauth.ts';
import { startOAuth2Connect } from '../_shared/genericOAuth2.ts';

// `offline.access` is what gets a refresh_token back alongside the access
// token — without it X only issues a short-lived (~2h) access token with no
// way to silently renew it.
const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const supabase = serviceClient();
  return startOAuth2Connect(supabase, req, {
    platform: 'x',
    clientIdCredentialKey: 'x_client_id',
    clientIdMissingMessage: 'X (Twitter) Client ID is not configured. Set it in Settings > Integrations.',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    clientIdParam: 'client_id',
    scope: X_SCOPES,
    usesPkce: true,
    redirectUriFunctionName: 'x-oauth-callback',
  });
});
