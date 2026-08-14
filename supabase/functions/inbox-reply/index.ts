import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { sendInboxReply } from '../_shared/inboxSend.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL')?.replace(/\/$/, '') || '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

type ReplyBody = { conversation_id: string; content: string; is_ai?: boolean };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return errorResponse('Unauthorized', 401);
    const { data: authData, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !authData.user) return errorResponse('Unauthorized', 401);
    const callerId = authData.user.id;

    const { conversation_id, content, is_ai }: ReplyBody = await req.json();
    if (!conversation_id || !content?.trim()) return errorResponse('conversation_id and content are required', 400);

    const { data: conv, error: convError } = await supabase
      .from('inbox_conversations')
      .select('id, workspace_id')
      .eq('id', conversation_id)
      .single();
    if (convError || !conv) return errorResponse('Conversation not found', 404);

    // Service-role bypasses RLS, so membership must be checked explicitly —
    // same reasoning as publish-post checking workspace_members itself.
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', conv.workspace_id)
      .eq('user_id', callerId)
      .maybeSingle();
    if (!membership) return errorResponse('Forbidden', 403);

    const message = await sendInboxReply(supabase, {
      conversation_id,
      content: content.trim(),
      is_ai: is_ai ?? false,
      user_id: callerId,
    });

    return jsonResponse({ message });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});
