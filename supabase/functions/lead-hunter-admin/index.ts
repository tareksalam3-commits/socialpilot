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

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function requireSuperAdmin(req: Request): Promise<{ userId: string } | Response> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'يجب تسجيل الدخول.' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return json(401, { error: 'انتهت جلسة الدخول.' });
  const { data: isAdmin } = await supabase.rpc('is_super_admin', { check_uid: data.user.id });
  if (!isAdmin) return json(403, { error: 'هذه العملية متاحة للـSuper Admin فقط.' });
  return { userId: data.user.id };
}

function withoutSecrets(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const copy = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    if (/key|secret|token|password|credential/i.test(key)) copy[key] = '[REDACTED]';
  }
  return copy;
}

async function adminLog(userId: string, action: string, resource: string, resourceId?: string, oldValue: unknown = {}, newValue: unknown = {}, severity = 'info') {
  await supabase.from('lead_hunter_admin_logs').insert({
    admin_user_id: userId,
    action,
    resource,
    resource_id: resourceId ?? null,
    old_value: withoutSecrets(oldValue),
    new_value: withoutSecrets(newValue),
    severity,
  });
}

async function getSettings() {
  const { data } = await supabase.from('lead_hunter_settings').select('*').eq('id', true).maybeSingle();
  return data ?? null;
}

async function getScoring() {
  const { data } = await supabase.from('lead_hunter_scoring_settings').select('*').eq('id', true).maybeSingle();
  return data ?? null;
}

async function checkSearxng(baseUrl: string | null): Promise<{ status: 'healthy' | 'degraded' | 'error' | 'not_configured'; message: string }> {
  const normalized = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  if (!normalized) return { status: 'not_configured', message: 'لم يتم ضبط SearXNG URL.' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`${normalized}/search?q=SocialPilot&format=json&language=en-US&pageno=1`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { status: 'error', message: `SearXNG HTTP ${response.status}.` };
    const payload = await response.json() as { results?: unknown[] };
    return Array.isArray(payload.results) ? { status: 'healthy', message: `SearXNG متصل (${payload.results.length} نتيجة فحص).` } : { status: 'degraded', message: 'استجابة SearXNG لا تحتوي على results array.' };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'تعذر الاتصال بـSearXNG.' };
  }
}

async function count(table: string, filters: Array<[string, string, unknown]> = []): Promise<number> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  for (const [column, operator, value] of filters) {
    if (operator === 'eq') query = query.eq(column, value);
    if (operator === 'gte') query = query.gte(column, value);
    if (operator === 'lt') query = query.lt(column, value);
    if (operator === 'in') query = query.in(column, value as unknown[]);
  }
  const { count: result } = await query;
  return result ?? 0;
}

async function overview() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const [total, newer, qualified, high, searchesToday, activeJobs, activeSources, sourceErrors, quality, score] = await Promise.all([
    count('leads'),
    count('leads', [['created_at', 'gte', today.toISOString()]]),
    count('leads', [['status', 'eq', 'qualified']]),
    count('leads', [['lead_score', 'gte', 75]]),
    count('lead_search_requests', [['created_at', 'gte', today.toISOString()], ['created_at', 'lt', tomorrow.toISOString()]]),
    count('lead_search_jobs', [['status', 'in', ['queued', 'running', 'paused']]]),
    count('lead_sources', [['enabled', 'eq', true]]),
    count('lead_sources', [['status', 'in', ['error', 'degraded']]]),
    average('leads', 'data_quality_score'),
    average('leads', 'lead_score'),
  ]);
  return { total, newer, qualified, high, searchesToday, activeJobs, activeSources, sourceErrors, averageQuality: quality, averageLeadScore: score };
}

async function average(table: string, column: string): Promise<number | null> {
  const { data } = await supabase.from(table).select(column).not(column, 'is', null).limit(1000);
  if (!data || data.length === 0) return null;
  const values = data.map((row) => Number((row as Record<string, unknown>)[column])).filter(Number.isFinite);
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
}

async function health() {
  const settings = await getSettings();
  const { data: sources } = await supabase.from('lead_sources').select('id,name,status,enabled,last_health_at,last_error,records_found').order('priority', { ascending: true }).limit(100);
  const { data: errors } = await supabase.from('lead_hunter_errors').select('severity,status').eq('status', 'open').limit(1000);
  const critical = (errors ?? []).filter((error) => error.severity === 'critical').length;
  return {
    services: [
      { key: 'supabase', label: 'Supabase', status: 'healthy', detail: 'متصل' },
      { key: 'ai_gateway', label: 'AI Gateway', status: settings?.lead_ai_enabled ? 'healthy' : 'warning', detail: settings?.lead_ai_enabled ? 'مفعّل' : 'معطّل' },
      { key: 'source_connectors', label: 'مصادر البيانات', status: (sources ?? []).some((source) => source.status === 'error') ? 'warning' : 'healthy', detail: `${(sources ?? []).filter((source) => source.enabled).length} مفعّل` },
      { key: 'searxng', label: 'SearXNG', status: settings?.searxng_last_health_status ?? 'not_configured', detail: settings?.searxng_last_health_error || settings?.searxng_base_url || 'غير مهيأ' },
      { key: 'job_queue', label: 'Job Queue', status: settings?.kill_switch ? 'warning' : 'healthy', detail: settings?.kill_switch ? 'متوقف مؤقتًا' : 'يعمل' },
      { key: 'storage', label: 'Storage', status: 'healthy', detail: 'متصل' },
      { key: 'authentication', label: 'Authentication', status: 'healthy', detail: 'متصل' },
      { key: 'notifications', label: 'Notifications', status: critical > 0 ? 'warning' : 'healthy', detail: critical > 0 ? `${critical} تنبيهات حرجة` : 'يعمل' },
    ],
    sources: sources ?? [],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'الطلب غير مدعوم.' });
  const auth = await requireSuperAdmin(req);
  if (auth instanceof Response) return auth;
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const userId = auth.userId;

    if (action === 'overview') return json(200, { overview: await overview() });
    if (action === 'health') return json(200, await health());
    if (action === 'get_settings') return json(200, { settings: await getSettings(), scoring: await getScoring() });
    if (action === 'list_sources') {
      const { data, error } = await supabase.from('lead_sources').select('id,workspace_id,name,connector_key,source_type,enabled,priority,rate_limit_per_minute,status,last_health_at,last_error,records_found,created_at,updated_at').order('priority', { ascending: true }).limit(200);
      if (error) throw error;
      return json(200, { sources: data ?? [] });
    }
    if (action === 'save_source') {
      const source = (body.source ?? {}) as Record<string, unknown>;
      if (!source.workspace_id || !source.name || !source.connector_key || !source.source_type) return json(400, { error: 'بيانات المصدر غير مكتملة.' });
      const payload = {
        workspace_id: String(source.workspace_id), name: String(source.name), connector_key: String(source.connector_key), source_type: String(source.source_type),
        enabled: Boolean(source.enabled ?? false), priority: Number(source.priority ?? 100), rate_limit_per_minute: source.rate_limit_per_minute ? Number(source.rate_limit_per_minute) : null,
        status: String(source.status ?? 'not_configured'), config: withoutSecrets(source.config),
      };
      const { data, error } = await supabase.from('lead_sources').upsert(payload, { onConflict: 'workspace_id,connector_key' }).select('id,workspace_id,name,connector_key,source_type,enabled,priority,rate_limit_per_minute,status,last_health_at,last_error,records_found,created_at,updated_at').single();
      if (error || !data) throw error ?? new Error('تعذر حفظ المصدر.');
      if (typeof body.api_key === 'string' && body.api_key.trim()) {
        await supabase.from('lead_source_secrets').upsert({ source_id: data.id, encrypted_config: { api_key: body.api_key.trim() }, updated_at: new Date().toISOString() });
      }
      await adminLog(userId, 'source_saved', 'lead_source', data.id, {}, payload);
      return json(200, { source: data });
    }
    if (action === 'toggle_source') {
      const sourceId = String(body.source_id ?? '');
      const { data: before } = await supabase.from('lead_sources').select('id,enabled,status').eq('id', sourceId).maybeSingle();
      if (!before) return json(404, { error: 'المصدر غير موجود.' });
      const enabled = Boolean(body.enabled);
      const { data, error } = await supabase.from('lead_sources').update({ enabled, status: enabled ? (before.status === 'disabled' ? 'not_configured' : before.status) : 'disabled' }).eq('id', sourceId).select('id,enabled,status').single();
      if (error) throw error;
      await adminLog(userId, enabled ? 'source_enabled' : 'source_disabled', 'lead_source', sourceId, before, data);
      return json(200, { source: data });
    }
    if (action === 'delete_source') {
      const sourceId = String(body.source_id ?? '');
      const { data: before } = await supabase.from('lead_sources').select('id,name').eq('id', sourceId).maybeSingle();
      const { error } = await supabase.from('lead_sources').delete().eq('id', sourceId);
      if (error) throw error;
      await adminLog(userId, 'source_deleted', 'lead_source', sourceId, before ?? {}, {});
      return json(200, { ok: true });
    }
    if (action === 'test_source') {
      const sourceId = String(body.source_id ?? '');
      const { data: source } = await supabase.from('lead_sources').select('id,workspace_id,connector_key,status,config').eq('id', sourceId).maybeSingle();
      if (!source) return json(404, { error: 'المصدر غير موجود.' });
      if (source.connector_key === 'searxng_search') {
        const settings = await getSettings();
        const config = (source.config ?? {}) as Record<string, unknown>;
        const result = await checkSearxng(typeof config.base_url === 'string' ? config.base_url : (settings?.searxng_base_url as string | null));
        const now = new Date().toISOString();
        await supabase.from('lead_sources').update({ status: result.status === 'healthy' ? 'healthy' : result.status, last_health_at: now, last_error: result.status === 'healthy' ? null : result.message }).eq('id', sourceId);
        await supabase.from('lead_hunter_settings').update({ searxng_last_health_at: now, searxng_last_health_status: result.status, searxng_last_health_error: result.status === 'healthy' ? null : result.message }).eq('id', true);
        await supabase.from('lead_hunter_source_runs').insert({ workspace_id: source.workspace_id, source_id: sourceId, status: result.status === 'healthy' ? 'success' : result.status === 'not_configured' ? 'not_configured' : 'error', success: result.status === 'healthy', finished_at: now, error_message: result.status === 'healthy' ? null : result.message });
        await adminLog(userId, 'source_tested', 'lead_source', sourceId, {}, { status: result.status, message: result.message }, result.status === 'healthy' ? 'info' : 'warning');
        return json(200, { ok: result.status === 'healthy', status: result.status, message: result.message });
      }
      const { data: secret } = await supabase.from('lead_source_secrets').select('source_id').eq('source_id', sourceId).maybeSingle();
      const status = 'not_configured';
      const message = secret ? 'هذا الموصل لا يملك فحصًا حيًا مفعّلًا في هذه النسخة.' : 'لم يتم حفظ بيانات اعتماد للمصدر.';
      await supabase.from('lead_sources').update({ status, last_health_at: new Date().toISOString(), last_error: message }).eq('id', sourceId);
      await supabase.from('lead_hunter_source_runs').insert({ workspace_id: source.workspace_id, source_id: sourceId, status: 'not_configured', finished_at: new Date().toISOString(), error_message: message });
      await adminLog(userId, 'source_tested', 'lead_source', sourceId, {}, { status, message }, 'warning');
      return json(200, { ok: false, status, message });
    }
    if (action === 'list_jobs') {
      const { data, error } = await supabase.from('lead_search_jobs').select('*, lead_search_requests(raw_query,requested_count,user_id,created_at)').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { jobs: data ?? [] });
    }
    if (action === 'job_action') {
      const jobId = String(body.job_id ?? '');
      const next = String(body.job_action ?? '');
      const status = next === 'pause' ? 'paused' : next === 'resume' || next === 'retry' ? 'queued' : next === 'cancel' ? 'cancelled' : null;
      if (!status) return json(400, { error: 'إجراء الـJob غير مدعوم.' });
      const { data: before } = await supabase.from('lead_search_jobs').select('id,status').eq('id', jobId).maybeSingle();
      if (!before) return json(404, { error: 'الـJob غير موجود.' });
      const { data, error } = await supabase.from('lead_search_jobs').update({ status, last_error: next === 'retry' ? null : undefined }).eq('id', jobId).select('id,status').single();
      if (error) throw error;
      await adminLog(userId, `job_${next}`, 'lead_search_job', jobId, before, data);
      return json(200, { job: data });
    }
    if (action === 'list_leads') {
      const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { leads: data ?? [] });
    }
    if (action === 'lead_action') {
      const leadId = String(body.lead_id ?? '');
      const leadAction = String(body.lead_action ?? '');
      const { data: before } = await supabase.from('leads').select('id,status,do_not_contact').eq('id', leadId).maybeSingle();
      if (!before) return json(404, { error: 'العميل غير موجود.' });
      if (leadAction === 'delete') await supabase.from('leads').delete().eq('id', leadId);
      else if (leadAction === 'suppress') {
        await supabase.from('leads').update({ do_not_contact: true, status: 'suppressed' }).eq('id', leadId);
        await supabase.from('lead_suppression_list').upsert({ workspace_id: String(body.workspace_id ?? ''), lead_id: leadId, normalized_key: `lead:${leadId}`, reason: 'إضافة من Super Admin', created_by: userId });
      } else if (leadAction === 'restore') await supabase.from('leads').update({ do_not_contact: false, status: 'new' }).eq('id', leadId);
      else return json(400, { error: 'إجراء العميل غير مدعوم.' });
      await adminLog(userId, `lead_${leadAction}`, 'lead', leadId, before, { action: leadAction });
      return json(200, { ok: true });
    }
    if (action === 'list_suppression') {
      const { data, error } = await supabase.from('lead_suppression_list').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { suppression: data ?? [] });
    }
    if (action === 'list_campaigns') {
      const { data, error } = await supabase.from('lead_campaigns').select('*, lead_campaign_members(count)').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { campaigns: data ?? [] });
    }
    if (action === 'list_exports') {
      const { data, error } = await supabase.from('lead_exports').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { exports: data ?? [] });
    }
    if (action === 'list_usage') {
      const { data, error } = await supabase.from('lead_hunter_usage_events').select('event_type,units,workspace_id,user_id,source_id,created_at').order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return json(200, { usage: data ?? [] });
    }
    if (action === 'list_logs') {
      const { data, error } = await supabase.from('lead_hunter_admin_logs').select('id,admin_user_id,action,resource,resource_id,severity,created_at').order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      return json(200, { logs: data ?? [] });
    }
    if (action === 'list_errors') {
      const { data, error } = await supabase.from('lead_hunter_errors').select('*').order('last_occurred_at', { ascending: false }).limit(300);
      if (error) throw error;
      return json(200, { errors: data ?? [] });
    }
    if (action === 'resolve_error') {
      const errorId = String(body.error_id ?? '');
      const { data: errorRow } = await supabase.from('lead_hunter_errors').select('id,status').eq('id', errorId).maybeSingle();
      if (!errorRow) return json(404, { error: 'الخطأ غير موجود.' });
      await supabase.from('lead_hunter_errors').update({ status: String(body.error_action ?? 'resolved'), resolved_at: new Date().toISOString() }).eq('id', errorId);
      await adminLog(userId, `error_${String(body.error_action ?? 'resolved')}`, 'lead_hunter_error', errorId, errorRow, {});
      return json(200, { ok: true });
    }
    if (action === 'list_permissions') {
      const { data, error } = await supabase.from('lead_hunter_permissions').select('user_id,permission,granted_by,created_at').order('created_at', { ascending: false }).limit(500);
      if (error) throw error;
      return json(200, { permissions: data ?? [] });
    }
    if (action === 'list_workspaces') {
      const { data, error } = await supabase.from('workspaces').select('id,name,plan,created_at,updated_at').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { workspaces: data ?? [] });
    }
    if (action === 'list_limits') {
      const { data, error } = await supabase.from('lead_hunter_workspace_limits').select('*').order('updated_at', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { limits: data ?? [] });
    }
    if (action === 'save_limit') {
      const payload = body.limit as Record<string, unknown>;
      const workspaceId = String(payload.workspace_id ?? '');
      if (!workspaceId) return json(400, { error: 'Workspace مطلوب.' });
      const { data, error } = await supabase.from('lead_hunter_workspace_limits').upsert({ ...payload, workspace_id: workspaceId, updated_by: userId }).select('*').single();
      if (error) throw error;
      await adminLog(userId, 'quota_updated', 'workspace_limit', workspaceId, {}, payload);
      return json(200, { limit: data });
    }
    if (action === 'update_settings') {
      const current = await getSettings();
      const patch = withoutSecrets(body.settings);
      if (patch.searxng_base_url !== undefined && patch.searxng_base_url !== null) {
        try { const parsed = new URL(String(patch.searxng_base_url)); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad'); patch.searxng_base_url = parsed.toString().replace(/\/+$/, ''); }
        catch { return json(400, { error: 'SearXNG URL غير صالح.' }); }
      }
      for (const key of ['max_queries', 'max_fetches', 'max_rounds_fast', 'max_rounds_balanced', 'max_rounds_deep', 'max_candidates_per_round', 'max_runtime_seconds']) {
        if (patch[key] !== undefined && (!Number.isFinite(Number(patch[key])) || Number(patch[key]) <= 0 || Number(patch[key]) > 100000)) return json(400, { error: `قيمة ${key} غير صالحة.` });
        if (patch[key] !== undefined) patch[key] = Number(patch[key]);
      }
      const { data, error } = await supabase.from('lead_hunter_settings').update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', true).select('*').single();
      if (error) throw error;
      await adminLog(userId, 'settings_updated', 'lead_hunter_settings', undefined, current ?? {}, patch);
      return json(200, { settings: data });
    }
    if (action === 'update_scoring') {
      const current = await getScoring();
      const patch = withoutSecrets(body.scoring);
      const weights = patch.lead_score_weights as Record<string, unknown> | undefined;
      if (weights) {
        const total = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
        if (Math.round(total * 100) / 100 !== 100) return json(400, { error: 'يجب أن يساوي مجموع أوزان Lead Score نسبة 100%.' });
      }
      const { data, error } = await supabase.from('lead_hunter_scoring_settings').update({ ...patch, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', true).select('*').single();
      if (error) throw error;
      await adminLog(userId, 'scoring_updated', 'lead_hunter_scoring_settings', undefined, current ?? {}, patch);
      return json(200, { scoring: data });
    }
    if (action === 'list_prompts') {
      const { data, error } = await supabase.from('lead_hunter_prompts').select('id,task,version,prompt,model,enabled,created_by,created_at').order('task').order('version', { ascending: false }).limit(200);
      if (error) throw error;
      return json(200, { prompts: data ?? [] });
    }
    if (action === 'save_prompt') {
      const prompt = body.prompt as Record<string, unknown>;
      const { data, error } = await supabase.from('lead_hunter_prompts').insert({ ...prompt, created_by: userId }).select('id,task,version,prompt,model,enabled,created_by,created_at').single();
      if (error) throw error;
      await adminLog(userId, 'prompt_version_created', 'lead_hunter_prompt', data.id, {}, { task: data.task, version: data.version, model: data.model });
      return json(200, { prompt: data });
    }
    return json(400, { error: 'إجراء غير مدعوم.' });
  } catch (error) {
    console.error('lead-hunter-admin error', error instanceof Error ? error.message : 'unknown');
    return json(500, { error: 'تعذر تنفيذ عملية الإدارة. حاول مرة أخرى.' });
  }
});
