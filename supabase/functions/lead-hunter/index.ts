import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } },
);

type SourceRow = {
  id: string;
  name: string;
  connector_key: string;
  enabled: boolean;
  status: string;
  priority: number;
};

type JobRow = {
  id: string;
  workspace_id: string;
  search_request_id: string;
  status: string;
  retry_count: number;
  max_retries: number;
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function authorize(req: Request, workspaceId: string): Promise<{ userId: string } | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'يجب تسجيل الدخول.' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return json(401, { error: 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى.' });
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (!membership) return json(403, { error: 'ليس لديك صلاحية الوصول إلى هذه المساحة.' });
  return { userId: data.user.id };
}

async function writeAudit(workspaceId: string, userId: string, action: string, entity: string, entityId: string, detail: Record<string, unknown> = {}) {
  await supabase.from('lead_audit_logs').insert({ workspace_id: workspaceId, user_id: userId, action, entity, entity_id: entityId, detail });
}

async function processJob(job: JobRow, userId: string) {
  const startedAt = new Date().toISOString();
  await supabase.from('lead_search_jobs').update({
    status: 'running', progress_percent: 15, progress_stage: 'selecting_sources', started_at: startedAt,
  }).eq('id', job.id);
  await supabase.from('lead_search_requests').update({ status: 'running' }).eq('id', job.search_request_id);

  const { data: sources } = await supabase
    .from('lead_sources')
    .select('id,name,connector_key,enabled,status,priority')
    .eq('workspace_id', job.workspace_id)
    .order('priority', { ascending: true })
    .limit(100);
  const sourceRows = (sources ?? []) as SourceRow[];
  const enabledSources = sourceRows.filter((source) => source.enabled && source.status !== 'disabled');
  const sourceStats = enabledSources.map((source) => ({
    source: source.connector_key,
    name: source.name,
    status: 'not_configured',
    error: 'المصدر غير مهيأ لهذا النوع من البيانات.',
    retry_count: 0,
    records_found: 0,
    timestamp: new Date().toISOString(),
    duration: 0,
  }));

  // Connector implementations are intentionally opt-in. The first release never
  // scrapes private accounts or fabricates leads when no permitted connector exists.
  await supabase.from('lead_search_jobs').update({
    status: 'completed',
    progress_percent: 100,
    progress_stage: 'completed',
    source_stats: sourceStats,
    completed_at: new Date().toISOString(),
  }).eq('id', job.id);
  await supabase.from('lead_search_requests').update({
    status: 'completed',
    total_found: 0,
    valid_count: 0,
    duplicate_count: 0,
    invalid_count: 0,
    qualified_count: 0,
  }).eq('id', job.search_request_id);
  await supabase.from('notifications').insert({
    workspace_id: job.workspace_id,
    user_id: userId,
    type: 'lead_search_completed',
    title: 'اكتمل البحث عن العملاء',
    body: sourceStats.length > 0 ? 'المصادر المفعّلة غير مهيأة لهذا النوع من البيانات.' : 'لا يوجد مصدر بيانات مهيأ حاليًا.',
    payload: { job_id: job.id, search_request_id: job.search_request_id, qualified_count: 0 },
  });
  await writeAudit(job.workspace_id, userId, 'SearchCompleted', 'lead_search_job', job.id, { source_stats: sourceStats, qualified_count: 0 });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const body = await req.json() as { action?: string; workspace_id?: string; search_request_id?: string };
    const workspaceId = body.workspace_id;
    if (!workspaceId || !body.action) return json(400, { error: 'بيانات الطلب غير مكتملة.' });
    const auth = await authorize(req, workspaceId);
    if (auth instanceof Response) return auth;

    const { data: settings } = await supabase
      .from('lead_hunter_settings')
      .select('lead_hunter_enabled,lead_search_enabled,kill_switch')
      .eq('id', true)
      .maybeSingle();
    if (body.action === 'start_search' && settings && (!settings.lead_hunter_enabled || !settings.lead_search_enabled || settings.kill_switch)) {
      return json(423, { error: settings.kill_switch ? 'مركز العملاء متوقف مؤقتًا للصيانة.' : 'البحث عن العملاء معطّل حاليًا من إعدادات النظام.' });
    }

    if (body.action === 'start_search') {
      if (!body.search_request_id) return json(400, { error: 'معرّف طلب البحث مطلوب.' });
      const { data: request } = await supabase
        .from('lead_search_requests')
        .select('id,status')
        .eq('id', body.search_request_id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (!request) return json(404, { error: 'طلب البحث غير موجود.' });
      if (request.status !== 'confirmed' && request.status !== 'draft') return json(409, { error: 'لا يمكن بدء طلب البحث بهذه الحالة.' });

      const { data: existing } = await supabase.from('lead_search_jobs').select('*').eq('search_request_id', body.search_request_id).maybeSingle();
      let job = existing as JobRow | null;
      if (!job) {
        const { data: created, error } = await supabase.from('lead_search_jobs').insert({ workspace_id: workspaceId, search_request_id: body.search_request_id, status: 'queued' }).select('*').single();
        if (error || !created) return json(500, { error: 'تعذر إنشاء مهمة البحث.' });
        job = created as JobRow;
      }
      await writeAudit(workspaceId, auth.userId, 'SearchStarted', 'lead_search_job', job.id, { search_request_id: body.search_request_id });
      const runPromise = processJob(job, auth.userId).catch(async (error) => {
        const message = error instanceof Error ? error.message : 'تعذر تنفيذ البحث.';
        await supabase.from('lead_search_jobs').update({ status: 'failed', last_error: message, completed_at: new Date().toISOString() }).eq('id', job!.id);
        await supabase.from('lead_search_requests').update({ status: 'failed' }).eq('id', body.search_request_id);
        await writeAudit(workspaceId, auth.userId, 'SearchFailed', 'lead_search_job', job!.id, { error: message });
      });
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(runPromise);
      else await runPromise;
      return json(200, { job });
    }

    return json(400, { error: 'الإجراء غير مدعوم.' });
  } catch (error) {
    console.error('lead-hunter error', error);
    return json(500, { error: 'تعذر تنفيذ العملية. حاول مرة أخرى.' });
  }
});
