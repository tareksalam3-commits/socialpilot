import { corsHeadersFor, errorResponse, serviceClient } from '../_shared/oauth.ts';
import { startOAuth2Connect } from '../_shared/genericOAuth2.ts';

const THREADS_SCOPES = ['threads_basic', 'threads_content_publish'].join(',');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeadersFor(req) });

  try {
    const supabase = serviceClient();
    return await startOAuth2Connect(supabase, req, {
      platform: 'threads',
      clientIdCredentialKey: 'threads_app_id',
      clientIdMissingMessage: 'Threads App ID is not configured. Set it in Settings > Integrations.',
      authorizeUrl: 'https://threads.com/oauth/authorize',
      clientIdParam: 'client_id',
      scope: THREADS_SCOPES,
      usesPkce: false,
      redirectUriFunctionName: 'threads-oauth-callback',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[threads-oauth-connect] unhandled error:', message);
    return errorResponse(`Could not start OAuth flow: ${message}`, 500);
  }
});
