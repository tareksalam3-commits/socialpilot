import { corsHeadersFor, errorResponse, serviceClient } from '../_shared/oauth.ts';
import { startOAuth2Connect } from '../_shared/genericOAuth2.ts';

const TIKTOK_SCOPES = ['user.info.basic', 'video.publish', 'video.upload'].join(',');

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeadersFor(req) });

  try {
    const supabase = serviceClient();
    return await startOAuth2Connect(supabase, req, {
      platform: 'tiktok',
      clientIdCredentialKey: 'tiktok_client_key',
      clientIdMissingMessage: 'TikTok Client Key is not configured. Set it in Settings > Integrations.',
      authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
      clientIdParam: 'client_key', // TikTok's OAuth dialog calls this client_key, not client_id.
      scope: TIKTOK_SCOPES,
      usesPkce: true,
      redirectUriFunctionName: 'tiktok-oauth-callback',
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[tiktok-oauth-connect] unhandled error:', message);
    return errorResponse(`Could not start OAuth flow: ${message}`, 500);
  }
});
