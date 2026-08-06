import { corsHeaders, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';

// Platform-level API keys the Super Admin panel manages — mainly fallback
// AI provider keys used when a workspace hasn't configured its own. Backed
// by `app_secrets`, which (by design) has no RLS policies at all, so it's
// only ever touched here with the service-role key after an explicit
// Super Admin check.
const ALLOWED_KEYS = new Set(['openai_api_key', 'anthropic_api_key', 'openrouter_api_key', 'google_ai_api_key']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const supabase = serviceClient();
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('platform_role')
    .eq('user_id', callerId)
    .maybeSingle();
  if (callerProfile?.platform_role !== 'super_admin') {
    return errorResponse('Only Super Admins can manage platform API keys', 403);
  }

  if (req.method === 'GET') {
    const { data } = await supabase.from('app_secrets').select('key, value').in('key', Array.from(ALLOWED_KEYS));
    const rows = data ?? [];
    const status: Record<string, { configured: boolean; masked: string | null }> = {};
    for (const key of ALLOWED_KEYS) {
      const row = rows.find((r) => r.key === key);
      const value = row?.value as string | undefined;
      status[key] = {
        configured: !!value,
        masked: value ? `${'•'.repeat(Math.max(value.length - 4, 4))}${value.slice(-4)}` : null,
      };
    }
    return jsonResponse({ keys: status });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const entries = Object.entries(body as Record<string, string>).filter(([key]) => ALLOWED_KEYS.has(key));
    if (entries.length === 0) return errorResponse('No recognized key names in request body', 400);

    const rows = entries.map(([key, value]) => ({ key, value: String(value).trim() }));
    const { error } = await supabase.from('app_secrets').upsert(rows, { onConflict: 'key' });
    if (error) return errorResponse(`Could not save keys: ${error.message}`, 500);

    await supabase.from('audit_logs').insert({
      actor_id: callerId,
      action: 'platform_api_keys.update',
      entity_type: 'app_secrets',
      metadata: { keys: entries.map(([key]) => key) },
    });

    return jsonResponse({ saved: entries.map(([key]) => key) });
  }

  if (req.method === 'DELETE') {
    const { key } = await req.json().catch(() => ({}));
    if (!key || !ALLOWED_KEYS.has(key)) return errorResponse('Unknown key', 400);
    await supabase.from('app_secrets').delete().eq('key', key);
    await supabase.from('audit_logs').insert({
      actor_id: callerId,
      action: 'platform_api_keys.delete',
      entity_type: 'app_secrets',
      entity_id: key,
    });
    return jsonResponse({ deleted: key });
  }

  return errorResponse('Method not allowed', 405);
});
