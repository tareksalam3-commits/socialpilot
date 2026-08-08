import { corsHeaders, serviceClient } from '../_shared/oauth.ts';
import { startOAuth2Connect } from '../_shared/genericOAuth2.ts';

const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'].join(',');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const supabase = serviceClient();
  return startOAuth2Connect(supabase, req, {
    platform: 'threads',
    clientIdCredentialKey: 'threads_app_id',
    clientIdMissingMessage: 'Threads App ID is not configured. Set it in Settings > Integrations.',
    authorizeUrl: 'https://threads.net/oauth/authorize',
    clientIdParam: 'client_id',
    scope: THREADS_SCOPES,
    usesPkce: false,
    redirectUriFunctionName: 'threads-oauth-callback',
  });
});
