import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// ---------------------------------------------------------------------------
// automation-control — current-schema control plane
//
// The former live implementation depended on connected_accounts, posts, and
// post_platform_targets. Those tables are not part of the current product
// schema. This implementation uses calendar_items + publishing_jobs and
// delegates every actual API request to social-publish, which keeps one
// idempotency and status-transition implementation for manual, retry, and
// scheduled publishing.
// ---------------------------------------------------------------------------

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL')?.replace(/\/$/, '') || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const MAX_BATCH = 25;

type ControlAction = 'retry_target' | 'retry_all_failed' | 'run_now';

type ControlBody = {
  action?: ControlAction;
  workspace_id?: string;
  workspaceId?: string;
  job_id?: string;
  jobId?: string;
  // Accepted only as a compatibility alias for clients that used the old
  // action name; it is looked up in publishing_jobs, never in legacy tables.
  target_id?: string;
};

type PublishJob = {
  id: string;
  workspace_id: string;
  variant_id: string | null;
  calendar_item_id: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  platform: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

async function getCallerId(req: Request): Promise<{ id: string; token: string } | null> {
  const header = req.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, token };
}

async function publishThroughCanonicalPath(
  userToken: string,
  job: Pick<PublishJob, 'workspace_id' | 'variant_id' | 'calendar_item_id'>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  if (!job.variant_id) {
    return { ok: false, status: 400, body: { error: 'Publishing job has no content variant' } };
  }

  const response = await fetch(`${supabaseUrl}/functions/v1/social-publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userToken}`,
      ...(anonKey ? { apikey: anonKey } : {}),
    },
    body: JSON.stringify({
      workspaceId: job.workspace_id,
      variantId: job.variant_id,
      calendarItemId: job.calendar_item_id ?? undefined,
    }),
  });

  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    body = { error: `social-publish returned HTTP ${response.status}` };
  }
  return { ok: response.ok && body.ok === true, status: response.status, body };
}

async function getJob(jobId: string, workspaceId: string): Promise<PublishJob | null> {
  const { data, error } = await supabase
    .from('publishing_jobs')
    .select('id, workspace_id, variant_id, calendar_item_id, status, attempts, max_attempts, platform')
    .eq('id', jobId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as PublishJob | null;
}

async function executeJob(userToken: string, job: PublishJob): Promise<Record<string, unknown>> {
  if (!job.variant_id) return { job_id: job.id, ok: false, status: 400, error: 'job_has_no_variant' };
  if (job.status === 'succeeded') return { job_id: job.id, ok: true, alreadyPublished: true };
  if (job.attempts >= job.max_attempts) return { job_id: job.id, ok: false, status: 409, error: 'max_attempts_reached' };

  const result = await publishThroughCanonicalPath(userToken, job);
  return {
    job_id: job.id,
    ok: result.ok,
    status: result.status,
    ...(result.body.postId ? { postId: result.body.postId } : {}),
    ...(result.body.url ? { url: result.body.url } : {}),
    ...(result.body.alreadyPublished ? { alreadyPublished: true } : {}),
    ...(result.body.error ? { error: result.body.error } : {}),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const caller = await getCallerId(req);
  if (!caller) return errorResponse('Unauthorized', 401);

  let body: ControlBody;
  try {
    body = await req.json() as ControlBody;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const action = body.action;
  const workspaceId = body.workspace_id ?? body.workspaceId;
  if (!action || !workspaceId) return errorResponse('action and workspace_id are required', 400);

  const { data: membership, error: membershipError } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', caller.id)
    .maybeSingle();
  if (membershipError) return errorResponse(membershipError.message, 500);
  if (!membership) return errorResponse('Forbidden', 403);

  try {
    if (action === 'retry_target') {
      const jobId = body.job_id ?? body.jobId ?? body.target_id;
      if (!jobId) return errorResponse('job_id is required for retry_target', 400);
      const job = await getJob(jobId, workspaceId);
      if (!job) return errorResponse('Publishing job not found', 404);
      if (job.status !== 'failed') return errorResponse('Only failed publishing jobs can be retried', 400);
      return jsonResponse(await executeJob(caller.token, job));
    }

    if (action === 'retry_all_failed') {
      const { data: jobs, error } = await supabase
        .from('publishing_jobs')
        .select('id, workspace_id, variant_id, calendar_item_id, status, attempts, max_attempts, platform')
        .eq('workspace_id', workspaceId)
        .eq('status', 'failed')
        .lt('attempts', 3)
        .order('last_attempt_at', { ascending: true, nullsFirst: true })
        .limit(MAX_BATCH);
      if (error) return errorResponse(error.message, 500);

      const results: Record<string, unknown>[] = [];
      for (const row of (jobs ?? []) as PublishJob[]) {
        results.push(await executeJob(caller.token, row));
      }
      return jsonResponse({ retried: results.length, succeeded: results.filter((item) => item.ok === true).length, results });
    }

    if (action === 'run_now') {
      const now = new Date().toISOString();
      const { data: items, error } = await supabase
        .from('calendar_items')
        .select('id, workspace_id, variant_id, scheduled_for, status')
        .eq('workspace_id', workspaceId)
        .in('status', ['scheduled', 'failed'])
        .not('variant_id', 'is', null)
        .lte('scheduled_for', now)
        .order('scheduled_for', { ascending: true })
        .limit(MAX_BATCH);
      if (error) return errorResponse(error.message, 500);

      const results: Record<string, unknown>[] = [];
      for (const item of items ?? []) {
        const { data: job, error: jobError } = await supabase
          .from('publishing_jobs')
          .select('id, workspace_id, variant_id, calendar_item_id, status, attempts, max_attempts, platform')
          .eq('workspace_id', workspaceId)
          .eq('calendar_item_id', item.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (jobError) {
          results.push({ calendar_item_id: item.id, ok: false, error: jobError.message });
          continue;
        }
        if (!job) {
          results.push({ calendar_item_id: item.id, ok: false, error: 'publishing_job_not_found' });
          continue;
        }
        const result = await executeJob(caller.token, job as PublishJob);
        if (result.ok === true && result.alreadyPublished === true) {
          await supabase.from('calendar_items').update({ status: 'published' }).eq('id', item.id).eq('workspace_id', workspaceId);
        }
        results.push({ calendar_item_id: item.id, ...result });
      }

      return jsonResponse({ checked: results.length, published: results.filter((item) => item.ok === true).length, results, checked_at: now });
    }

    return errorResponse(`Unknown action: ${action}`, 400);
  } catch (error) {
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
  }
});
