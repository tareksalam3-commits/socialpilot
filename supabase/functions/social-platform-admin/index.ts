import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// ---------------------------------------------------------------------------
// Social Integrations Control Center backend — Super Admin only. Mirrors the
// ai-admin function's split pattern: non-secret config lives in
// social_platform_apps (readable by supabase clients once is_super_admin()),
// the app secret lives in social_platform_app_secrets which has no RLS
// policies at all and is reachable only from here via the service role.
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

async function requireSuperAdmin(req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, response: jsonRes(401, { error: 'Missing authentication token' }) };

  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return { ok: false, response: jsonRes(401, { error: 'Invalid or expired token' }) };

  const { data: isAdmin } = await supabase.rpc('is_super_admin', { check_uid: userData.user.id });
  if (!isAdmin) return { ok: false, response: jsonRes(403, { error: 'Forbidden — Super Admin only' }) };

  return { ok: true, userId: userData.user.id };
}

const VALID_PLATFORM_KEYS = new Set(['meta', 'linkedin']);

type Action =
  | { action: 'list_apps' }
  | { action: 'save_app'; platformKey: string; appId: string; appSecret?: string; redirectUri?: string }
  | { action: 'set_enabled'; platformKey: string; enabled: boolean }
  | { action: 'remove_app'; platformKey: string };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes(405, { error: 'Method not allowed' });

  const auth = await requireSuperAdmin(req);
  if (!auth.ok) return auth.response;

  let body: Action;
  try {
    body = await req.json();
  } catch {
    return jsonRes(400, { error: 'Invalid JSON body' });
  }

  try {
    switch (body.action) {
      case 'list_apps': {
        const { data, error } = await supabase.from('social_platform_apps').select('*').order('platform_key');
        if (error) return jsonRes(500, { error: error.message });
        return jsonRes(200, { apps: data ?? [] });
      }

      case 'save_app': {
        if (!VALID_PLATFORM_KEYS.has(body.platformKey)) return jsonRes(400, { error: 'Unknown platform' });
        if (!body.appId || body.appId.trim().length < 3) return jsonRes(400, { error: 'App ID is required' });

        const functionsBase = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1`;
        const redirectUri = body.redirectUri?.trim() || `${functionsBase}/social-oauth-callback`;

        if (body.appSecret && body.appSecret.trim().length > 0) {
          await supabase.from('social_platform_app_secrets').upsert({
            platform_key: body.platformKey,
            app_secret: body.appSecret.trim(),
            updated_at: new Date().toISOString(),
          });
        }

        const { data: existingSecret } = await supabase
          .from('social_platform_app_secrets')
          .select('platform_key')
          .eq('platform_key', body.platformKey)
          .maybeSingle();

        await supabase.from('social_platform_apps').update({
          app_id: body.appId.trim(),
          redirect_uri: redirectUri,
          has_secret: !!existingSecret,
          status: existingSecret ? 'connected' : 'not_configured',
          enabled: !!existingSecret,
          last_error: null,
          updated_at: new Date().toISOString(),
        }).eq('platform_key', body.platformKey);

        return jsonRes(200, { ok: true, redirectUri });
      }

      case 'set_enabled': {
        await supabase.from('social_platform_apps').update({ enabled: body.enabled }).eq('platform_key', body.platformKey);
        return jsonRes(200, { ok: true });
      }

      case 'remove_app': {
        await supabase.from('social_platform_app_secrets').delete().eq('platform_key', body.platformKey);
        await supabase.from('social_platform_apps').update({
          app_id: null,
          has_secret: false,
          enabled: false,
          status: 'not_configured',
          last_error: null,
        }).eq('platform_key', body.platformKey);
        return jsonRes(200, { ok: true });
      }

      default:
        return jsonRes(400, { error: 'Unknown action' });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return jsonRes(500, { error: message });
  }
});
