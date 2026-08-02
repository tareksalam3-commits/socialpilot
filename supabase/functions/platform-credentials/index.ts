import { corsHeaders, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';

// Whitelist of credential keys the client is allowed to touch. Keeps this
// function from becoming a generic "write anything to any table" endpoint.
const ALLOWED_KEYS = new Set(['meta_app_id', 'meta_app_secret', 'linkedin_client_id', 'linkedin_client_secret', 'app_url']);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const supabase = serviceClient();
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  if (req.method === 'GET') {
    const { data } = await supabase.from('platform_credentials').select('key, value, updated_at');
    const rows = data ?? [];
    // Never echo secret values back to the client — only whether each is
    // configured (and, for the one non-secret field, its actual value so
    // the form can show it).
    const status: Record<string, { configured: boolean; updated_at: string | null; value?: string }> = {};
    for (const key of ALLOWED_KEYS) {
      const row = rows.find((r) => r.key === key);
      status[key] = {
        configured: !!row?.value,
        updated_at: (row?.updated_at as string) ?? null,
        ...(key === 'app_url' && row?.value ? { value: row.value as string } : {}),
      };
    }
    return jsonResponse({ credentials: status });
  }

  if (req.method === 'POST') {
    // Only workspace owners/admins may change platform-wide credentials.
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('user_id', callerId)
      .in('role', ['owner', 'admin'])
      .limit(1)
      .maybeSingle();
    if (!membership) return errorResponse('Only workspace owners or admins can update integration credentials', 403);

    const body = await req.json().catch(() => ({}));
    const entries = Object.entries(body as Record<string, string>).filter(([key]) => ALLOWED_KEYS.has(key));
    if (entries.length === 0) return errorResponse('No recognized credential keys in request body', 400);

    for (const [, value] of entries) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        return errorResponse('Credential values must be non-empty strings', 400);
      }
    }

    const rows = entries.map(([key, value]) => ({
      key,
      value: value.trim(),
      updated_at: new Date().toISOString(),
      updated_by: callerId,
    }));

    const { error } = await supabase.from('platform_credentials').upsert(rows, { onConflict: 'key' });
    if (error) return errorResponse(`Could not save credentials: ${error.message}`, 500);

    return jsonResponse({ saved: entries.map(([key]) => key) });
  }

  if (req.method === 'DELETE') {
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('user_id', callerId)
      .in('role', ['owner', 'admin'])
      .limit(1)
      .maybeSingle();
    if (!membership) return errorResponse('Only workspace owners or admins can update integration credentials', 403);

    const { key } = await req.json().catch(() => ({}));
    if (!key || !ALLOWED_KEYS.has(key)) return errorResponse('Unknown credential key', 400);

    await supabase.from('platform_credentials').delete().eq('key', key);
    return jsonResponse({ deleted: key });
  }

  return errorResponse('Method not allowed', 405);
});
