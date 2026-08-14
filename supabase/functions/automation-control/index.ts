import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { log, publishPost, retryTarget } from '../_shared/orchestrator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL')?.replace(/\/$/, '') || '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

type ControlAction = 'retry_target' | 'retry_all_failed' | 'run_now';

type ControlBody = {
  action: ControlAction;
  workspace_id: string;
  target_id?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    // Same identity model as publish-post: verify the caller directly
    // against the auth server, then check workspace membership ourselves
    // since the service-role client bypasses RLS entirely.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return errorResponse('Unauthorized', 401);
    const { data: authData, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !authData.user) return errorResponse('Unauthorized', 401);
    const callerId = authData.user.id;

    const { action, workspace_id, target_id }: ControlBody = await req.json();
    if (!action || !workspace_id) return errorResponse('action and workspace_id are required', 400);

    const { data: membership } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('user_id', callerId)
      .maybeSingle();
    if (!membership) return errorResponse('Forbidden', 403);

    if (action === 'retry_target') {
      if (!target_id) return errorResponse('target_id is required for retry_target', 400);

      const { data: target, error: targetError } = await supabase.from('post_platform_targets').select('*').eq('id', target_id).single();
      if (targetError || !target) return errorResponse('Target not found', 404);

      const { data: post, error: postError } = await supabase.from('posts').select('*').eq('id', target.post_id).single();
      if (postError || !post || post.workspace_id !== workspace_id) return errorResponse('Target not found', 404);
      if (target.status !== 'failed') return errorResponse('Only failed targets can be retried', 400);

      const ok = await retryTarget(supabase, target, post, callerId);
      return jsonResponse({ success: ok, target_id });
    }

    if (action === 'retry_all_failed') {
      const { data: failedTargets } = await supabase
        .from('post_platform_targets')
        .select('*, posts!inner(*)')
        .eq('status', 'failed')
        .eq('posts.workspace_id', workspace_id);

      let succeeded = 0;
      let stillFailed = 0;
      for (const row of failedTargets ?? []) {
        const { posts: post, ...target } = row as Record<string, unknown> & { posts: Record<string, unknown> };
        const ok = await retryTarget(supabase, target, post, callerId);
        if (ok) succeeded++;
        else stillFailed++;
      }
      return jsonResponse({ retried: (failedTargets ?? []).length, succeeded, still_failed: stillFailed });
    }

    if (action === 'run_now') {
      // Manual "run now" — processes this workspace's due jobs immediately,
      // regardless of the Auto Publish toggle (an explicit user action).
      const now = new Date().toISOString();
      let published = 0;
      let failed = 0;

      const { data: duePosts } = await supabase
        .from('posts')
        .select('*')
        .eq('workspace_id', workspace_id)
        .eq('status', 'scheduled')
        .lte('scheduled_for', now)
        .limit(25);

      for (const post of duePosts ?? []) {
        await supabase.from('posts').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', post.id);
        await log(supabase, { workspace_id, post_id: post.id, event: 'queued', message: 'Manual "run now" triggered' });
        const status = await publishPost(supabase, post, callerId);
        if (status === 'published') published++;
        else failed++;
      }

      const { data: dueTargets } = await supabase
        .from('post_platform_targets')
        .select('*, posts!inner(*)')
        .eq('status', 'failed')
        .eq('posts.workspace_id', workspace_id)
        .not('next_retry_at', 'is', null)
        .lte('next_retry_at', now)
        .limit(50);

      let retried = 0;
      for (const row of dueTargets ?? []) {
        const { posts: post, ...target } = row as Record<string, unknown> & { posts: Record<string, unknown> };
        const ok = await retryTarget(supabase, target, post, callerId);
        if (ok) retried++;
        else failed++;
      }

      return jsonResponse({ published, retried, failed, checked_at: now });
    }

    return errorResponse(`Unknown action: ${action}`, 400);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});
