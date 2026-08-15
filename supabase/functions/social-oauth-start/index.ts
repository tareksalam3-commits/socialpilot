import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// ---------------------------------------------------------------------------
// Called by a logged-in workspace member from "المزيد > الحسابات > ربط".
// Verifies the caller belongs to the workspace, mints a short-lived CSRF
// state row, and returns the Meta OAuth dialog URL for the client to open.
// The actual token exchange happens in social-oauth-callback, which Meta
// redirects the browser to directly (no Authorization header available then
// — that's why the workspace/user identity travels via the `state` row).
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } }
);

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes(405, { error: 'Method not allowed' });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return jsonRes(401, { error: 'Missing authentication token' });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return jsonRes(401, { error: 'Invalid or expired token' });
  const userId = userData.user.id;

  let body: { workspaceId?: string; platformKey?: string };
  try {
    body = await req.json();
  } catch {
    return jsonRes(400, { error: 'Invalid JSON body' });
  }

  const workspaceId = body.workspaceId;
  const platformKey = body.platformKey ?? 'meta';
  if (!workspaceId) return jsonRes(400, { error: 'workspaceId is required' });

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return jsonRes(403, { error: 'You do not have access to this workspace' });

  const { data: app } = await supabase
    .from('social_platform_apps')
    .select('*')
    .eq('platform_key', platformKey)
    .maybeSingle();

  if (!app || !app.app_id || !app.has_secret) {
    return jsonRes(409, { error: 'لسه الأدمن ما ضبطش إعدادات ربط فيسبوك/إنستجرام. راجع Super Admin > تكاملات التواصل الاجتماعي.' });
  }
  if (!app.enabled) {
    return jsonRes(409, { error: 'ربط فيسبوك/إنستجرام معطّل حاليًا من الأدمن.' });
  }

  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const { error: stateError } = await supabase.from('social_oauth_states').insert({
    state,
    workspace_id: workspaceId,
    user_id: userId,
    platform_key: platformKey,
  });
  if (stateError) return jsonRes(500, { error: 'تعذّر بدء عملية الربط' });

  const redirectUri = app.redirect_uri || `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/social-oauth-callback`;
  const scope = app.scopes || 'pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_metadata,instagram_basic,instagram_content_publish,business_management';

  const authUrl = new URL('https://www.facebook.com/v20.0/dialog/oauth');
  authUrl.searchParams.set('client_id', app.app_id);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('response_type', 'code');

  return jsonRes(200, { url: authUrl.toString() });
});
