import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  processLeadIntake,
  mergeLeadUpdates,
  type RawLeadInput,
  type LeadIntakeMeta,
  type LeadIntakeSourceType,
  type DuplicateCandidate,
  type LeadRecord,
} from './pipeline.ts';
import {
  buildSpecification,
  buildResearchPlan,
  runResearchLoop,
  CONNECTOR_REGISTRY,
  type ParsedLeadQuery,
  type SearchModeName,
  type AICaller,
} from './researchAgent.ts';
import { createSerperConnector } from './connectors/serper.ts';
import { createSearXNGConnector, discoverSearXNGCapabilities } from './connectors/searxng.ts';

// Register real search connectors once at module load (§20, §22 — the
// connector is a tool, shared across every workspace's job in this
// isolate). It is stateless: every call carries its own decrypted API key
// as an argument (see resolveSourceCredentials below), so concurrent jobs
// from different workspaces never share or leak a key.
CONNECTOR_REGISTRY.set('serper_search', createSerperConnector());
CONNECTOR_REGISTRY.set('searxng_search', createSearXNGConnector());

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
  config?: Record<string, unknown>;
};

type JobRow = {
  id: string;
  workspace_id: string;
  search_request_id: string;
  status: string;
  retry_count: number;
  max_retries: number;
};

type SettingsRow = {
  data_quality_threshold: number;
  max_rounds_fast: number;
  max_rounds_balanced: number;
  max_rounds_deep: number;
  max_candidates_per_round: number;
  max_runtime_seconds: number;
  max_queries: number;
  max_fetches: number;
  searxng_base_url: string | null;
  search_categories?: string[];
  search_languages?: string[];
  search_allowed_engines?: string[];
  allow_social_search?: boolean;
  allow_site_search?: boolean;
  default_time_range?: string | null;
  searxng_capabilities?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// AI Gateway bridge (§1, §4, §10, §15, §18, §19) — the research loop is
// AI-code, not AI-decoration: every plan/extract/verify/review step is a
// real call to the same AI Gateway every other agent in the product goes
// through (ai-gateway/index.ts), never a second parallel "AI" implemented
// inline here. Background jobs have no live user session, so they
// authenticate with the service role key; ai-gateway/index.ts has an
// additive service-role bypass in `authorize()` for exactly this case.
const AI_GATEWAY_URL = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/ai-gateway`;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const AI_GATEWAY_TIMEOUT_MS = 20_000;

function buildAiCaller(workspaceId: string, userId: string): AICaller {
  return async (step, payload) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_GATEWAY_TIMEOUT_MS);
    try {
      const res = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          intent: 'research_agent_reasoning',
          workspaceId,
          onBehalfOfUserId: userId,
          message: `Lead Hunter research agent step: ${step}`,
          context: { step, ...payload },
        }),
      });
      if (!res.ok) return null;
      const body = await res.json() as { result?: Record<string, unknown>; provider?: string; model?: string; fallbackCount?: number; fallbackLog?: Array<{ provider: string; model: string; error: string }> };
      if (!body.result) return null;
      return {
        ...body.result,
        __ai_provider: body.provider ?? null,
        __ai_model: body.model ?? null,
        __ai_fallback_count: Number(body.fallbackCount ?? 0),
        __ai_fallback_log: Array.isArray(body.fallbackLog) ? body.fallbackLog : [],
      };
    } catch {
      // AI Gateway unreachable or timed out — the loop treats this as
      // ai_unavailable for the step and never fabricates a decision.
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}

async function resolveSourceCredentials(sources: SourceRow[], searxngBaseUrl: string | null): Promise<Map<string, { apiKey: string | null; baseUrl: string | null }>> {
  const ids = sources.map((s) => s.id);
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from('lead_source_secrets').select('source_id,encrypted_config').in('source_id', ids);
  const bySourceId = new Map((data ?? []).map((row) => [row.source_id as string, (row.encrypted_config as Record<string, unknown> | null) ?? {}]));
  const byConnectorKey = new Map<string, { apiKey: string | null; baseUrl: string | null }>();
  for (const source of sources) {
    const secret = bySourceId.get(source.id) ?? {};
    const config = source.config ?? {};
    const apiKey = typeof secret.api_key === 'string' && secret.api_key.trim() ? secret.api_key.trim() : null;
    const baseUrl = typeof config.base_url === 'string' && config.base_url.trim() ? config.base_url.trim() : (source.connector_key === 'searxng_search' ? searxngBaseUrl : null);
    byConnectorKey.set(source.connector_key, { apiKey, baseUrl });
  }
  return byConnectorKey;
}

// Arabic labels for these stage keys live in one place on the frontend:
// src/modules/lead-hunter/types/index.ts → LEAD_JOB_STAGE_LABELS (§30).

const LEAD_STATUSES = ['new', 'qualified', 'contacted', 'converted', 'suppressed', 'invalid', 'archived'];
const IMPORT_SOURCE_TYPES: LeadIntakeSourceType[] = ['manual', 'csv', 'excel', 'api', 'existing_crm', 'test'];
const CANDIDATE_COLUMNS = 'id,full_name,governorate,city,business_phone,public_contact_phone,business_email,public_email,professional_url,social_url';
const MAX_BATCH_IMPORT = 2000;
const MAX_EXPORT_ROWS = 5000;

// Full set of real columns Lead Hunter export can show. Every entry exists
// on `leads` today — the actual display formatting (Arabic headers, phone
// as text, date formatting, RTL layout) happens client-side; see
// src/modules/lead-hunter/services/leadExport.ts.
const EXPORT_COLUMNS = [
  'full_name', 'business_phone', 'public_contact_phone', 'business_email', 'public_email',
  'governorate', 'city', 'district', 'occupation', 'job_title', 'industry', 'employer',
  'source_type', 'source_url', 'collected_at', 'last_verified_at',
  'data_quality_score', 'lead_score', 'status', 'do_not_contact', 'notes',
];

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

// ---------------------------------------------------------------------------
// Search job processing — AI Research Agent (understand → plan → search
// loop → analyze → verify → qualify → score → rank). See researchAgent.ts
// for the loop itself; this function does the DB IO around it.
// ---------------------------------------------------------------------------

const JOB_WATCHDOG_MS = 240_000;

async function updateStage(jobId: string, stage: string, percent: number) {
  await supabase.from('lead_search_jobs').update({ progress_stage: stage, progress_percent: percent }).eq('id', jobId).eq('status', 'running');
}

async function runProcessJobWithWatchdog(job: JobRow, userId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      processJob(job, userId),
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error('انتهت مهلة تنفيذ Job البحث قبل الوصول إلى نتيجة نهائية.')), JOB_WATCHDOG_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function processJob(job: JobRow, userId: string) {
  const startedAt = new Date().toISOString();
  await supabase.from('lead_search_jobs').update({
    status: 'running', progress_percent: 5, progress_stage: 'understanding', started_at: startedAt,
  }).eq('id', job.id);
  await supabase.from('lead_search_requests').update({ status: 'running' }).eq('id', job.search_request_id);

  const [{ data: request }, { data: settingsRow }, { data: sources }] = await Promise.all([
    supabase.from('lead_search_requests').select('id,parsed_query,raw_query,requested_count,objective,search_mode').eq('id', job.search_request_id).maybeSingle(),
    supabase.from('lead_hunter_settings').select('data_quality_threshold,max_rounds_fast,max_rounds_balanced,max_rounds_deep,max_candidates_per_round,max_runtime_seconds,max_queries,max_fetches,searxng_base_url,search_categories,search_languages,search_allowed_engines,allow_social_search,allow_site_search,default_time_range,searxng_capabilities').eq('id', true).maybeSingle(),
    supabase.from('lead_sources').select('id,name,connector_key,enabled,status,priority,config').eq('workspace_id', job.workspace_id).order('priority', { ascending: true }).limit(100),
  ]);

  if (!request) {
    await supabase.from('lead_search_jobs').update({ status: 'failed', last_error: 'طلب البحث غير موجود.', completed_at: new Date().toISOString() }).eq('id', job.id);
    return;
  }

  const settings = (settingsRow ?? {
    data_quality_threshold: 60, max_rounds_fast: 1, max_rounds_balanced: 3, max_rounds_deep: 6,     max_candidates_per_round: 200, max_runtime_seconds: 900, max_queries: 24, max_fetches: 40, searxng_base_url: null, search_categories: ['general'], search_languages: ['ar-EG', 'en-US'], search_allowed_engines: [], allow_social_search: true, allow_site_search: true, default_time_range: null, searxng_capabilities: {},
  }) as SettingsRow;
  const mode = (['fast', 'balanced', 'deep'].includes(String(request.search_mode)) ? request.search_mode : (settings.default_search_mode ?? 'balanced')) as SearchModeName;
  const maxRounds = mode === 'fast' ? settings.max_rounds_fast : mode === 'deep' ? settings.max_rounds_deep : settings.max_rounds_balanced;

  const parsedQuery = (request.parsed_query ?? {}) as ParsedLeadQuery;
  const requestedCount = Number(request.requested_count) > 0 ? Number(request.requested_count) : 100;
  const spec = buildSpecification({ ...parsedQuery, requestedCount, objective: request.objective ?? undefined });
  if (typeof settings.data_quality_threshold === 'number') spec.soft.qualityMin = Math.max(spec.soft.qualityMin, settings.data_quality_threshold);
  const plan = buildResearchPlan(spec, mode, maxRounds);

  await updateStage(job.id, 'understanding', 10);
  await supabase.from('lead_search_requests').update({
    hard_requirements: spec.hard, soft_requirements: spec.soft, research_plan: plan,
  }).eq('id', job.search_request_id);

  await updateStage(job.id, 'planning', 20);

  const sourceRows = (sources ?? []) as SourceRow[];
  const enabledSources = sourceRows.filter((source) => source.enabled && source.status !== 'disabled');
  const credentials = await resolveSourceCredentials(enabledSources, settings.searxng_base_url ?? null);
  const sourceCapabilities: Record<string, Record<string, unknown>> = {};
  const searxngSource = enabledSources.find((source) => source.connector_key === 'searxng_search');
  if (searxngSource) {
    const capabilities = await discoverSearXNGCapabilities(credentials.get('searxng_search')?.baseUrl ?? settings.searxng_base_url ?? null);
    sourceCapabilities.searxng_search = capabilities as unknown as Record<string, unknown>;
    const now = new Date().toISOString();
    await supabase.from('lead_hunter_settings').update({ searxng_capabilities: capabilities, searxng_last_health_at: now, searxng_last_health_status: capabilities.status, searxng_last_health_error: capabilities.status === 'healthy' ? null : capabilities.message }).eq('id', true);
    await supabase.from('lead_sources').update({ status: capabilities.status, last_health_at: now, last_error: capabilities.status === 'healthy' ? null : capabilities.message }).eq('id', searxngSource.id);
  }

  await updateStage(job.id, 'searching', 35);
  const loopResult = await runResearchLoop({
    spec,
    mode,
    maxRounds,
    maxQueries: Math.max(1, settings.max_queries ?? 24),
    maxFetches: Math.max(0, settings.max_fetches ?? 40),
    maxCandidatesPerRound: settings.max_candidates_per_round ?? 200,
    maxRuntimeMs: Math.max(30_000, (settings.max_runtime_seconds ?? 900) * 1000),
    sources: enabledSources.map((s) => ({ source_id: s.id, connector_key: s.connector_key, enabled: s.enabled, ...(credentials.get(s.connector_key) ?? { apiKey: null, baseUrl: null }) })),
    isDuplicate: async (candidate) => (await fetchDuplicateCandidates(job.workspace_id, candidate)).length > 0,
    aiCall: buildAiCaller(job.workspace_id, userId),
    onProgress: (stage, percent) => updateStage(job.id, stage, percent),
    searchConstraints: { categories: settings.search_categories ?? ['general'], languages: settings.search_languages ?? ['ar-EG', 'en-US'], engines: settings.search_allowed_engines ?? [], allowSocialSearch: settings.allow_social_search !== false, allowSiteSearch: settings.allow_site_search !== false, defaultTimeRange: settings.default_time_range ?? null },
    sourceCapabilities,
  });

  // Candidate ledger (§7: Candidate ≠ Lead) — every raw result the loop
  // touched this job, whatever happened to it, goes into the existing
  // lead_source_records table (collected/normalized/validated/rejected).
  // This was always the schema's intended purpose; the loop just wasn't
  // writing to it before.
  if (loopResult.candidateLedger.length > 0) {
    const sourceIdByConnectorKey = new Map(enabledSources.map((s) => [s.connector_key, s.id]));
    const ledgerRows = loopResult.candidateLedger
      .map((entry) => {
        const sourceId = sourceIdByConnectorKey.get(entry.source_id);
        if (!sourceId) return null;
        return {
          workspace_id: job.workspace_id,
          source_id: sourceId,
          external_id: entry.external_id,
          source_url: entry.source_url,
          raw_record: entry.raw_record,
          extraction_status: entry.extraction_status,
          validation_error: entry.validation_error,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (ledgerRows.length > 0) {
      await supabase.from('lead_source_records').upsert(ledgerRows, { onConflict: 'source_id,external_id', ignoreDuplicates: false });
    }
  }

  await updateStage(job.id, 'analyzing', 55);
  await updateStage(job.id, 'verifying', 65);
  await updateStage(job.id, 'qualifying', 75);
  await updateStage(job.id, 'ranking', 85);

  // Save + rank accepted candidates through the existing intake pipeline —
  // no parallel save path, per §25.
  let rank = 0;
  let savedCount = 0;
  for (const candidate of loopResult.accepted) {
    rank += 1;
    try {
      const saved = await saveAcceptedLead(job.workspace_id, candidate.lead, candidate.dataQuality, candidate.score);
      await supabase.from('lead_search_results').insert({
        workspace_id: job.workspace_id, search_request_id: job.search_request_id, job_id: job.id,
        lead_id: saved.id, rank, inclusion_status: saved.status === 'suppressed' ? 'suppressed' : 'included',
        deduplication_status: 'not_match', data_quality_score: candidate.dataQuality.score,
      });
      // Link the candidate ledger row to the lead it became, so a lead can
      // always be traced back to its original evidence (§7, §9).
      if (candidate.lead.source_url) {
        await supabase.from('lead_source_records')
          .update({ normalized_lead_id: saved.id, extraction_status: 'validated' })
          .eq('workspace_id', job.workspace_id)
          .eq('source_url', candidate.lead.source_url as string)
          .is('normalized_lead_id', null);
      }
      const sourceId = typeof candidate.lead.source_id === 'string' ? candidate.lead.source_id : null;
      const evidenceRows = candidate.evidence
        .filter((item) => item.source_url && item.snippet)
        .map((item) => ({
          workspace_id: job.workspace_id,
          lead_id: saved.id,
          search_request_id: job.search_request_id,
          source_id: sourceId,
          source_url: item.source_url,
          field: item.field || 'general',
          evidence_text: item.snippet.slice(0, 4000),
          evidence_type: item.verified ? 'verification' : 'snippet',
          verified: Boolean(item.verified),
        }));
      if (evidenceRows.length > 0) {
        await supabase.from('lead_evidence').upsert(evidenceRows, { onConflict: 'lead_id,source_url,field,evidence_text', ignoreDuplicates: true });
      }
      savedCount += 1;
    } catch (error) {
      console.error('failed to save research lead', error);
    }
  }

  const noSourceStage = loopResult.stopReason === 'NOT_CONFIGURED';
  const finalStage = noSourceStage ? (enabledSources.length > 0 ? 'not_configured' : 'no_source_configured') : 'completed';

  await supabase.from('lead_search_jobs').update({
    status: 'completed',
    progress_percent: 100,
    progress_stage: finalStage,
    source_stats: loopResult.sourceStats,
    queries_used: loopResult.queriesUsed,
    rounds_completed: loopResult.roundsCompleted,
    stop_reason: loopResult.stopReason,
    strategy_notes: loopResult.strategyNotes,
    search_memory: loopResult.searchMemory,
    search_summary: loopResult.searchSummary,
    completed_at: new Date().toISOString(),
  }).eq('id', job.id).eq('status', 'running');

  await supabase.from('lead_search_requests').update({
    status: 'completed',
    total_found: loopResult.totals.found,
    valid_count: loopResult.totals.found - loopResult.totals.rejected,
    duplicate_count: loopResult.totals.duplicates,
    invalid_count: loopResult.totals.rejected,
    qualified_count: savedCount,
  }).eq('id', job.search_request_id).eq('status', 'running');

  const body = noSourceStage
    ? 'تم فهم الطلب ووضع خطة بحث فعلية، لكن لا يوجد مصدر بحث مصرّح به ومهيأ حاليًا — لم يتم اختلاق أي نتائج.'
    : `تم العثور على ${savedCount} عميلًا مطابقًا بجودة عالية عبر ${loopResult.roundsCompleted} جولة بحث (${loopResult.totals.verified} تم التحقق منهم، ${loopResult.totals.verificationConflicts} استُبعدوا بسبب تعارض في التحقق).`;
  await supabase.from('notifications').insert({
    workspace_id: job.workspace_id,
    user_id: userId,
    type: 'lead_search_completed',
    title: 'اكتمل البحث عن العملاء',
    body,
    payload: {
      job_id: job.id, search_request_id: job.search_request_id, qualified_count: savedCount, stop_reason: loopResult.stopReason,
      found: loopResult.totals.found, rejected: loopResult.totals.rejected, duplicates: loopResult.totals.duplicates,
      verified: loopResult.totals.verified, verification_conflicts: loopResult.totals.verificationConflicts,
      search_summary: loopResult.searchSummary,
    },
  });
  await writeAudit(job.workspace_id, userId, 'SearchCompleted', 'lead_search_job', job.id, {
    source_stats: loopResult.sourceStats, qualified_count: savedCount, stop_reason: loopResult.stopReason, rounds: loopResult.roundsCompleted,
    strategy_notes: loopResult.strategyNotes, search_memory: loopResult.searchMemory, search_summary: loopResult.searchSummary, totals: loopResult.totals,
  });
}

// ---------------------------------------------------------------------------
// Lead intake — shared by add_lead / import_leads. Uses the pipeline in
// pipeline.ts for normalize/validate/dedupe/quality/score; this file only
// does DB IO (fetch candidates, suppression check, insert/update).
// ---------------------------------------------------------------------------

async function fetchDuplicateCandidates(workspaceId: string, normalized: LeadRecord): Promise<DuplicateCandidate[]> {
  const byId = new Map<string, DuplicateCandidate>();
  const add = (rows: unknown[] | null) => {
    for (const row of rows ?? []) {
      const candidate = row as DuplicateCandidate;
      byId.set(candidate.id, candidate);
    }
  };

  const phoneVals = [normalized.business_phone, normalized.public_contact_phone].filter(Boolean) as string[];
  if (phoneVals.length) {
    const [byBusiness, byPublic] = await Promise.all([
      supabase.from('leads').select(CANDIDATE_COLUMNS).eq('workspace_id', workspaceId).in('business_phone', phoneVals).limit(10),
      supabase.from('leads').select(CANDIDATE_COLUMNS).eq('workspace_id', workspaceId).in('public_contact_phone', phoneVals).limit(10),
    ]);
    add(byBusiness.data);
    add(byPublic.data);
  }

  const emailVals = [normalized.business_email, normalized.public_email].filter(Boolean) as string[];
  if (emailVals.length) {
    const [byBusiness, byPublic] = await Promise.all([
      supabase.from('leads').select(CANDIDATE_COLUMNS).eq('workspace_id', workspaceId).in('business_email', emailVals).limit(10),
      supabase.from('leads').select(CANDIDATE_COLUMNS).eq('workspace_id', workspaceId).in('public_email', emailVals).limit(10),
    ]);
    add(byBusiness.data);
    add(byPublic.data);
  }

  if (normalized.professional_url) {
    const { data } = await supabase.from('leads').select(CANDIDATE_COLUMNS).eq('workspace_id', workspaceId).eq('professional_url', normalized.professional_url as string).limit(5);
    add(data);
  }
  if (normalized.social_url) {
    const { data } = await supabase.from('leads').select(CANDIDATE_COLUMNS).eq('workspace_id', workspaceId).eq('social_url', normalized.social_url as string).limit(5);
    add(data);
  }

  if (normalized.full_name && (normalized.governorate || normalized.city)) {
    let query = supabase.from('leads').select(CANDIDATE_COLUMNS).eq('workspace_id', workspaceId).limit(50);
    query = normalized.governorate ? query.eq('governorate', normalized.governorate as string) : query.eq('city', normalized.city as string);
    const { data } = await query;
    add(data);
  }

  return Array.from(byId.values());
}

async function checkSuppression(workspaceId: string, lead: LeadRecord): Promise<string | null> {
  const keys: string[] = [];
  if (lead.business_phone) keys.push(`phone:${lead.business_phone}`);
  if (lead.public_contact_phone) keys.push(`phone:${lead.public_contact_phone}`);
  if (lead.business_email) keys.push(`email:${lead.business_email}`);
  if (lead.public_email) keys.push(`email:${lead.public_email}`);
  if (!keys.length) return null;
  const { data } = await supabase
    .from('lead_suppression_list')
    .select('reason')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .in('normalized_key', keys)
    .limit(1);
  return data && data.length > 0 ? String(data[0].reason ?? 'مدرج في قائمة عدم التواصل.') : null;
}

async function saveAcceptedLead(
  workspaceId: string,
  lead: LeadRecord,
  dataQuality: { score: number; reasons: string[] },
  score: { score: number; priority: string; reasons: string[] },
): Promise<{ id: string; status: string }> {
  const suppressionReason = await checkSuppression(workspaceId, lead);
  const insertPayload: Record<string, unknown> = {
    workspace_id: workspaceId,
    ...lead,
    status: suppressionReason ? 'suppressed' : 'new',
    do_not_contact: Boolean(suppressionReason),
  };
  const { data, error } = await supabase.from('leads').insert(insertPayload).select('id,status').single();
  if (error || !data) throw new Error('تعذر حفظ العميل.');

  const contactRows: Array<Record<string, unknown>> = [];
  const pushContact = (type: string, value: unknown) => {
    if (!value) return;
    contactRows.push({ workspace_id: workspaceId, lead_id: data.id, contact_type: type, value, normalized_value: value, collected_at: lead.collected_at ?? new Date().toISOString() });
  };
  pushContact('business_phone', lead.business_phone);
  pushContact('public_contact_phone', lead.public_contact_phone);
  pushContact('business_email', lead.business_email);
  pushContact('public_email', lead.public_email);
  if (contactRows.length) {
    await supabase.from('lead_contacts').upsert(contactRows, { onConflict: 'lead_id,contact_type,normalized_value' });
  }

  await supabase.from('lead_scores').insert({
    workspace_id: workspaceId,
    lead_id: data.id,
    search_request_id: null,
    score: score.score,
    priority: score.priority,
    reasons: [...dataQuality.reasons, ...score.reasons],
    scoring_version: 'intake-v1',
  });

  if (suppressionReason) {
    await supabase.from('lead_suppression_list').upsert(
      { workspace_id: workspaceId, lead_id: data.id, normalized_key: `lead:${data.id}`, reason: suppressionReason, active: true },
      { onConflict: 'workspace_id,normalized_key' },
    );
  }

  return data as { id: string; status: string };
}

async function runIntake(workspaceId: string, raw: RawLeadInput, meta: LeadIntakeMeta) {
  const result = await processLeadIntake(raw, meta, (normalized) => fetchDuplicateCandidates(workspaceId, normalized));
  if (result.status === 'rejected') return result;
  if (result.status === 'duplicate') {
    const { data: existing } = await supabase.from('leads').select('*').eq('id', result.duplicate.leadId).eq('workspace_id', workspaceId).maybeSingle();
    if (existing) {
      const updates = mergeLeadUpdates(existing as LeadRecord, result.lead);
      if (Object.keys(updates).length > 0) {
        await supabase.from('leads').update(updates).eq('id', result.duplicate.leadId);
      }
    }
    return result;
  }
  const saved = await saveAcceptedLead(workspaceId, result.lead, result.dataQuality, result.score);
  return { ...result, leadId: saved.id, savedStatus: saved.status };
}

// ---------------------------------------------------------------------------
// HTTP entry point
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  try {
    const body = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? '');
    const workspaceId = String(body.workspace_id ?? '');
    if (!workspaceId || !action) return json(400, { error: 'بيانات الطلب غير مكتملة.' });
    const auth = await authorize(req, workspaceId);
    if (auth instanceof Response) return auth;
    const userId = auth.userId;

    const { data: settings } = await supabase
      .from('lead_hunter_settings')
      .select('lead_hunter_enabled,lead_search_enabled,kill_switch,search_quota_daily,search_quota_monthly,default_search_mode')
      .eq('id', true)
      .maybeSingle();
    if (settings?.kill_switch) return json(423, { error: 'مركز العملاء متوقف مؤقتًا للصيانة.' });
    if (action === 'start_search' && settings && !settings.lead_search_enabled) {
      return json(423, { error: 'البحث عن العملاء معطّل حاليًا من إعدادات النظام.' });
    }
    if (action !== 'start_search' && settings && settings.lead_hunter_enabled === false) {
      return json(423, { error: 'مركز العملاء معطّل حاليًا من إعدادات النظام.' });
    }

    if (action === 'start_search') {
      const search_request_id = body.search_request_id as string | undefined;
      if (!search_request_id) return json(400, { error: 'معرّف طلب البحث مطلوب.' });
      const { data: request } = await supabase
        .from('lead_search_requests')
        .select('id,status')
        .eq('id', search_request_id)
        .eq('workspace_id', workspaceId)
        .maybeSingle();
      if (!request) return json(404, { error: 'طلب البحث غير موجود.' });
      if (request.status !== 'confirmed' && request.status !== 'draft') return json(409, { error: 'لا يمكن بدء طلب البحث بهذه الحالة.' });

      const { data: existing } = await supabase.from('lead_search_jobs').select('*').eq('search_request_id', search_request_id).maybeSingle();
      if (!existing) {
        const now = new Date();
        const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const [{ count: dailyCount }, { count: monthlyCount }] = await Promise.all([
          supabase.from('lead_search_requests').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', dayStart).limit(1),
          supabase.from('lead_search_requests').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('created_at', monthStart).limit(1),
        ]);
        if (Number(dailyCount ?? 0) >= Number(settings?.search_quota_daily ?? 100)) return json(429, { error: 'تم تجاوز حصة البحث اليومية لهذه المساحة.' });
        if (Number(monthlyCount ?? 0) >= Number(settings?.search_quota_monthly ?? 2000)) return json(429, { error: 'تم تجاوز حصة البحث الشهرية لهذه المساحة.' });
      }
      let job = existing as JobRow | null;
      if (!job) {
        const { data: created, error } = await supabase.from('lead_search_jobs').insert({ workspace_id: workspaceId, search_request_id, status: 'queued' }).select('*').single();
        if (error || !created) return json(500, { error: 'تعذر إنشاء مهمة البحث.' });
        job = created as JobRow;
      }
      await writeAudit(workspaceId, userId, 'SearchStarted', 'lead_search_job', job.id, { search_request_id });
      const runPromise = runProcessJobWithWatchdog(job, userId).catch(async (error) => {
        const message = error instanceof Error ? error.message : 'تعذر تنفيذ البحث.';
        await supabase.from('lead_search_jobs').update({ status: 'failed', progress_stage: 'failed', last_error: message, completed_at: new Date().toISOString() }).eq('id', job!.id).eq('status', 'running');
        await supabase.from('lead_search_requests').update({ status: 'failed' }).eq('id', search_request_id).eq('status', 'running');
        await writeAudit(workspaceId, userId, 'SearchFailed', 'lead_search_job', job!.id, { error: message });
      });
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(runPromise);
      else await runPromise;
      return json(200, { job });
    }

    if (action === 'add_lead') {
      const raw = (body.lead ?? {}) as RawLeadInput;
      const meta: LeadIntakeMeta = { sourceType: 'manual', sourceId: null, sourceUrl: null, collectedAt: new Date().toISOString() };
      const result = await runIntake(workspaceId, raw, meta);
      await writeAudit(workspaceId, userId, 'LeadAdded', 'lead', 'leadId' in result ? String(result.leadId) : 'n/a', { status: result.status });
      return json(200, { result });
    }

    if (action === 'import_leads') {
      const rows = (body.leads ?? []) as RawLeadInput[];
      const sourceType = IMPORT_SOURCE_TYPES.includes(body.source_type as LeadIntakeSourceType) ? (body.source_type as LeadIntakeSourceType) : 'manual';
      if (!Array.isArray(rows) || rows.length === 0) return json(400, { error: 'لا توجد بيانات للاستيراد.' });
      if (rows.length > MAX_BATCH_IMPORT) return json(400, { error: `الحد الأقصى للاستيراد دفعة واحدة ${MAX_BATCH_IMPORT} سجل.` });
      const meta: LeadIntakeMeta = {
        sourceType,
        sourceId: (body.source_id as string) ?? null,
        sourceUrl: (body.source_url as string) ?? null,
        collectedAt: new Date().toISOString(),
      };
      let accepted = 0, duplicates = 0, rejected = 0;
      const rejectedDetails: Array<{ raw: RawLeadInput; errors: string[] }> = [];
      for (const row of rows) {
        const result = await runIntake(workspaceId, row, meta);
        if (result.status === 'accepted') accepted += 1;
        else if (result.status === 'duplicate') duplicates += 1;
        else { rejected += 1; if (rejectedDetails.length < 50) rejectedDetails.push({ raw: result.raw, errors: result.errors }); }
      }
      await writeAudit(workspaceId, userId, 'LeadsImported', 'lead_import', sourceType, { total: rows.length, accepted, duplicates, rejected });
      return json(200, { totalFound: rows.length, accepted, duplicates, rejected, rejectedDetails });
    }

    if (action === 'update_lead') {
      const leadId = String(body.lead_id ?? '');
      const patch = (body.patch ?? {}) as RawLeadInput & { notes?: string | null };
      if (!leadId) return json(400, { error: 'معرّف العميل مطلوب.' });
      const { data: existing } = await supabase.from('leads').select('*').eq('id', leadId).eq('workspace_id', workspaceId).maybeSingle();
      if (!existing) return json(404, { error: 'العميل غير موجود.' });
      const meta: LeadIntakeMeta = { sourceType: 'manual', collectedAt: existing.collected_at ?? new Date().toISOString() };
      const merged: RawLeadInput = {
        full_name: patch.full_name ?? existing.full_name,
        first_name: patch.first_name ?? existing.first_name,
        last_name: patch.last_name ?? existing.last_name,
        age: patch.age ?? existing.age,
        gender: patch.gender ?? existing.gender,
        occupation: patch.occupation ?? existing.occupation,
        job_title: patch.job_title ?? existing.job_title,
        industry: patch.industry ?? existing.industry,
        employer: patch.employer ?? existing.employer,
        country: patch.country ?? existing.country,
        governorate: patch.governorate ?? existing.governorate,
        city: patch.city ?? existing.city,
        district: patch.district ?? existing.district,
        business_phone: patch.business_phone ?? existing.business_phone,
        public_contact_phone: patch.public_contact_phone ?? existing.public_contact_phone,
        business_email: patch.business_email ?? existing.business_email,
        public_email: patch.public_email ?? existing.public_email,
        professional_url: patch.professional_url ?? existing.professional_url,
        social_url: patch.social_url ?? existing.social_url,
        notes: patch.notes ?? existing.notes,
      };
      const result = await processLeadIntake(merged, meta, (normalized) =>
        fetchDuplicateCandidates(workspaceId, normalized).then((rows) => rows.filter((r) => r.id !== leadId)));
      if (result.status === 'rejected') return json(422, { error: 'بيانات التعديل غير صالحة.', errors: result.errors });
      if (result.status === 'duplicate') return json(409, { error: 'هذا التعديل يطابق عميلًا آخر موجودًا بالفعل.', duplicate: result.duplicate });
      const leadPatch = Object.fromEntries(Object.entries(result.lead).filter(([key]) => key !== 'lead_score'));
      const { error } = await supabase.from('leads').update({ ...leadPatch, data_quality_score: result.dataQuality.score, lead_score: result.score.score }).eq('id', leadId);
      if (error) return json(500, { error: 'تعذر حفظ التعديل.' });
      await supabase.from('lead_scores').insert({ workspace_id: workspaceId, lead_id: leadId, search_request_id: null, score: result.score.score, priority: result.score.priority, reasons: result.score.reasons, scoring_version: 'intake-v1' });
      await writeAudit(workspaceId, userId, 'LeadUpdated', 'lead', leadId, { patch: Object.keys(patch) });
      return json(200, { ok: true, dataQuality: result.dataQuality, score: result.score });
    }

    if (action === 'update_status') {
      const leadId = String(body.lead_id ?? '');
      const status = String(body.status ?? '');
      if (!leadId || !LEAD_STATUSES.includes(status)) return json(400, { error: 'الحالة غير مدعومة.' });
      const { data: before } = await supabase.from('leads').select('id,status').eq('id', leadId).eq('workspace_id', workspaceId).maybeSingle();
      if (!before) return json(404, { error: 'العميل غير موجود.' });
      const { error } = await supabase.from('leads').update({ status }).eq('id', leadId);
      if (error) return json(500, { error: 'تعذر تحديث الحالة.' });
      await writeAudit(workspaceId, userId, 'LeadStatusChanged', 'lead', leadId, { from: before.status, to: status });
      return json(200, { ok: true });
    }

    if (action === 'add_tag' || action === 'remove_tag') {
      const leadId = String(body.lead_id ?? '');
      const tagName = String(body.tag_name ?? '').trim();
      if (!leadId || !tagName) return json(400, { error: 'بيانات الوسم غير مكتملة.' });
      const { data: tag, error: tagError } = await supabase
        .from('lead_tags')
        .upsert({ workspace_id: workspaceId, name: tagName }, { onConflict: 'workspace_id,name' })
        .select('id')
        .single();
      if (tagError || !tag) return json(500, { error: 'تعذر حفظ الوسم.' });
      if (action === 'add_tag') {
        await supabase.from('lead_tag_links').upsert({ workspace_id: workspaceId, lead_id: leadId, tag_id: tag.id }, { onConflict: 'lead_id,tag_id' });
      } else {
        await supabase.from('lead_tag_links').delete().eq('lead_id', leadId).eq('tag_id', tag.id);
      }
      await writeAudit(workspaceId, userId, action === 'add_tag' ? 'LeadTagAdded' : 'LeadTagRemoved', 'lead', leadId, { tag: tagName });
      return json(200, { ok: true });
    }

    if (action === 'suppress_lead' || action === 'unsuppress_lead') {
      const leadId = String(body.lead_id ?? '');
      if (!leadId) return json(400, { error: 'معرّف العميل مطلوب.' });
      const { data: lead } = await supabase.from('leads').select('id,business_phone,public_contact_phone,business_email,public_email').eq('id', leadId).eq('workspace_id', workspaceId).maybeSingle();
      if (!lead) return json(404, { error: 'العميل غير موجود.' });
      if (action === 'suppress_lead') {
        const reason = String(body.reason ?? 'طلب توقف تواصل من فريق المبيعات.');
        await supabase.from('leads').update({ do_not_contact: true, status: 'suppressed' }).eq('id', leadId);
        const keys = [lead.business_phone, lead.public_contact_phone].filter(Boolean).map((v) => `phone:${v}`)
          .concat([lead.business_email, lead.public_email].filter(Boolean).map((v) => `email:${v}`));
        keys.push(`lead:${leadId}`);
        for (const key of keys) {
          await supabase.from('lead_suppression_list').upsert({ workspace_id: workspaceId, lead_id: leadId, normalized_key: key, reason, active: true, created_by: userId }, { onConflict: 'workspace_id,normalized_key' });
        }
        await writeAudit(workspaceId, userId, 'LeadSuppressed', 'lead', leadId, { reason });
      } else {
        await supabase.from('leads').update({ do_not_contact: false, status: 'new' }).eq('id', leadId);
        await supabase.from('lead_suppression_list').update({ active: false }).eq('workspace_id', workspaceId).eq('lead_id', leadId);
        await writeAudit(workspaceId, userId, 'LeadUnsuppressed', 'lead', leadId, {});
      }
      return json(200, { ok: true });
    }

    if (action === 'create_campaign') {
      const campaign = (body.campaign ?? {}) as Record<string, unknown>;
      const name = String(campaign.name ?? '').trim();
      if (!name) return json(400, { error: 'اسم الحملة مطلوب.' });
      const { data, error } = await supabase.from('lead_campaigns').insert({
        workspace_id: workspaceId, user_id: userId, name, notes: campaign.notes ?? null, search_criteria: campaign.search_criteria ?? {},
      }).select('*').single();
      if (error || !data) return json(500, { error: 'تعذر إنشاء الحملة.' });
      await writeAudit(workspaceId, userId, 'CampaignCreated', 'lead_campaign', data.id, { name });
      return json(200, { campaign: data });
    }

    if (action === 'add_leads_to_campaign') {
      const campaignId = String(body.campaign_id ?? '');
      const leadIds = (body.lead_ids ?? []) as string[];
      if (!campaignId || !Array.isArray(leadIds) || leadIds.length === 0) return json(400, { error: 'بيانات الحملة غير مكتملة.' });
      const { data: eligible } = await supabase.from('leads').select('id').eq('workspace_id', workspaceId).eq('do_not_contact', false).in('id', leadIds);
      const eligibleIds = (eligible ?? []).map((row) => row.id as string);
      const skipped = leadIds.filter((id) => !eligibleIds.includes(id));
      if (eligibleIds.length) {
        const rows = eligibleIds.map((leadId) => ({ workspace_id: workspaceId, campaign_id: campaignId, lead_id: leadId, status: 'pending' }));
        await supabase.from('lead_campaign_members').upsert(rows, { onConflict: 'campaign_id,lead_id' });
      }
      await writeAudit(workspaceId, userId, 'CampaignLeadsAdded', 'lead_campaign', campaignId, { added: eligibleIds.length, skippedDoNotContact: skipped.length });
      return json(200, { added: eligibleIds.length, skippedDoNotContact: skipped.length });
    }

    if (action === 'remove_lead_from_campaign') {
      const campaignId = String(body.campaign_id ?? '');
      const leadId = String(body.lead_id ?? '');
      if (!campaignId || !leadId) return json(400, { error: 'بيانات الحملة غير مكتملة.' });
      await supabase.from('lead_campaign_members').delete().eq('workspace_id', workspaceId).eq('campaign_id', campaignId).eq('lead_id', leadId);
      await writeAudit(workspaceId, userId, 'CampaignLeadRemoved', 'lead_campaign', campaignId, { lead_id: leadId });
      return json(200, { ok: true });
    }

    if (action === 'update_campaign_member') {
      const campaignId = String(body.campaign_id ?? '');
      const leadId = String(body.lead_id ?? '');
      const status = String(body.status ?? '');
      const allowed = ['pending', 'contacted', 'qualified', 'converted', 'excluded'];
      if (!campaignId || !leadId || !allowed.includes(status)) return json(400, { error: 'بيانات غير صالحة.' });
      await supabase.from('lead_campaign_members').update({ status }).eq('workspace_id', workspaceId).eq('campaign_id', campaignId).eq('lead_id', leadId);
      await writeAudit(workspaceId, userId, 'CampaignMemberStatusChanged', 'lead_campaign', campaignId, { lead_id: leadId, status });
      return json(200, { ok: true });
    }

    if (action === 'export_leads') {
      const leadIds = (body.lead_ids ?? []) as string[];
      const filters = (body.filters ?? null) as Record<string, unknown> | null;
      const format = String(body.format ?? 'csv');
      const campaignId = (body.campaign_id as string) ?? null;
      const searchRequestId = (body.search_request_id as string) ?? null;
      if (!['csv', 'xlsx', 'json', 'pdf'].includes(format)) return json(400, { error: 'صيغة التصدير غير مدعومة.' });

      const hasExplicitIds = Array.isArray(leadIds) && leadIds.length > 0;
      if (!hasExplicitIds && !filters) return json(400, { error: 'لا توجد بيانات للتصدير.' });

      // Never trust a client-supplied workspace scope beyond `workspaceId`,
      // already authorized above — see §24 (no workspace bypass from frontend).
      let dataQuery = supabase.from('leads').select('*').eq('workspace_id', workspaceId);
      if (hasExplicitIds) {
        dataQuery = dataQuery.in('id', leadIds).limit(MAX_EXPORT_ROWS);
      } else {
        // "Current Filter" / "All Leads" / "Qualified" / "High Score" / etc. —
        // the caller sends the same filter shape used by Lead Management so the
        // exported file always matches exactly what the user is looking at.
        const f = filters ?? {};
        if (!f.includeDoNotContact) dataQuery = dataQuery.eq('do_not_contact', false);
        if (f.status) dataQuery = dataQuery.eq('status', String(f.status));
        if (f.governorate) dataQuery = dataQuery.eq('governorate', String(f.governorate));
        if (f.city) dataQuery = dataQuery.eq('city', String(f.city));
        if (typeof f.minQuality === 'number') dataQuery = dataQuery.gte('data_quality_score', f.minQuality);
        if (typeof f.minScore === 'number') dataQuery = dataQuery.gte('lead_score', f.minScore);
        if (f.search && String(f.search).trim()) {
          const term = String(f.search).trim();
          dataQuery = dataQuery.or(`full_name.ilike.%${term}%,occupation.ilike.%${term}%,job_title.ilike.%${term}%`);
        }
        if (f.tagId) {
          const { data: linked } = await supabase.from('lead_tag_links').select('lead_id').eq('workspace_id', workspaceId).eq('tag_id', String(f.tagId));
          const tagLeadIds = (linked ?? []).map((row) => row.lead_id as string);
          if (tagLeadIds.length === 0) return json(200, { content: '[]', count: 0, suppressedCount: 0, format, exportId: null });
          dataQuery = dataQuery.in('id', tagLeadIds);
        }
        dataQuery = dataQuery.order('lead_score', { ascending: false, nullsFirst: false }).limit(MAX_EXPORT_ROWS);
      }

      const { data: rows, error } = await dataQuery;
      if (error) return json(500, { error: 'تعذر تحميل بيانات التصدير.' });
      const all = rows ?? [];
      const suppressedCount = all.filter((r) => r.do_not_contact || r.status === 'suppressed').length;
      // Suppressed / do-not-contact leads never leave the system via export — §8, §18.
      const exportable = all.filter((r) => !r.do_not_contact && r.status !== 'suppressed')
        .sort((a, b) => (b.lead_score ?? -1) - (a.lead_score ?? -1));

      const structuredRows = exportable.map((r) => Object.fromEntries(EXPORT_COLUMNS.map((c) => [c, r[c] ?? null])));
      const content = JSON.stringify(structuredRows);

      const { data: exportRow, error: exportError } = await supabase.from('lead_exports').insert({
        workspace_id: workspaceId, user_id: userId, search_request_id: searchRequestId, campaign_id: campaignId,
        format, selected_columns: EXPORT_COLUMNS, status: 'completed',
        total_count: all.length, valid_count: exportable.length, suppressed_count: suppressedCount, completed_at: new Date().toISOString(),
      }).select('id').single();
      if (exportError) console.error('lead_exports insert failed', exportError);
      await writeAudit(workspaceId, userId, 'LeadsExported', 'lead_export', exportRow?.id ?? 'n/a', { format, total: all.length, exported: exportable.length, suppressed: suppressedCount });

      return json(200, { content, count: exportable.length, suppressedCount, format, exportId: exportRow?.id ?? null });
    }

    return json(400, { error: 'الإجراء غير مدعوم.' });
  } catch (error) {
    console.error('lead-hunter error', error);
    return json(500, { error: 'تعذر تنفيذ العملية. حاول مرة أخرى.' });
  }
});
