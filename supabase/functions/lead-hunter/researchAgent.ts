/**
 * AI Research Agent — Lead Hunter
 * ================================
 * The "brain": Understand → Plan → Search → Observe → Analyze → Question →
 * Adapt → Search again → Verify → Reject → Rank → Review → Stop.
 *
 * This file owns reasoning and orchestration only. It never talks to
 * secrets or the database directly (index.ts still owns all DB IO and
 * decrypts source credentials); it receives an `aiCall` function (real
 * calls to the AI Gateway, injected by index.ts) and a registered
 * `LeadSourceConnector` per enabled source, and drives a bounded
 * multi-round loop that actually reads what came back before deciding
 * what to do next.
 *
 * IMPORTANT — honesty over completeness (§21, §28, §33):
 * - If no connector is registered for any enabled source: stop with
 *   NOT_CONFIGURED. Zero fabricated leads.
 * - If the AI Gateway itself is unavailable for a given round: that round
 *   is recorded as `strategy_source: 'ai_unavailable'` and falls back to
 *   deterministic query generation for search only — raw search results
 *   are NEVER promoted to leads without a real AI extraction pass, because
 *   turning a SERP snippet into a structured person record requires
 *   reading it, not template-matching it (§4, §9, §11).
 */

import {
  dataQualityAssessment,
  scoreLeadIntake,
  normalizeLead,
  validateLead,
  type LeadRecord,
  type RawLeadInput,
  type LeadIntakeMeta,
} from './pipeline.ts';

// ---------------------------------------------------------------------------
// Structured Search Specification (§3, §4) — unchanged from prior version.
// ---------------------------------------------------------------------------

export type ParsedLeadQuery = {
  location?: { country?: string | null; governorate?: string | null; city?: string | null; district?: string | null };
  age?: { min?: number | null; max?: number | null };
  gender?: string | null;
  occupations?: string[];
  jobTitles?: string[];
  industries?: string[];
  interests?: string[];
  contactAvailability?: { phone?: boolean | null; email?: boolean | null };
  freshness?: string | null;
  qualityMin?: number | null;
  requestedCount: number;
  objective?: string;
};

export type SearchSpecification = {
  hard: {
    governorate: string | null;
    city: string | null;
    district: string | null;
    occupations: string[];
    jobTitles: string[];
    industries: string[];
  };
  soft: {
    ageMin: number | null;
    ageMax: number | null;
    gender: string | null;
    interests: string[];
    contactPhone: boolean;
    contactEmail: boolean;
    freshness: string | null;
    qualityMin: number;
  };
  requestedCount: number;
  objective: string;
};

export function buildSpecification(query: ParsedLeadQuery): SearchSpecification {
  return {
    hard: {
      governorate: query.location?.governorate || null,
      city: query.location?.city || null,
      district: query.location?.district || null,
      occupations: (query.occupations ?? []).filter(Boolean),
      jobTitles: (query.jobTitles ?? []).filter(Boolean),
      industries: (query.industries ?? []).filter(Boolean),
    },
    soft: {
      ageMin: query.age?.min ?? null,
      ageMax: query.age?.max ?? null,
      gender: query.gender || null,
      interests: (query.interests ?? []).filter(Boolean),
      contactPhone: query.contactAvailability?.phone !== false,
      contactEmail: Boolean(query.contactAvailability?.email),
      freshness: query.freshness || null,
      qualityMin: typeof query.qualityMin === 'number' ? query.qualityMin : 60,
    },
    requestedCount: query.requestedCount > 0 ? query.requestedCount : 100,
    objective: query.objective || 'life_insurance_lead',
  };
}

/** A candidate is rejected outright if it violates a stated Hard Requirement. Unknown = not rejected (§11: UNKNOWN beats an invented value). */
export function meetsHardRequirements(spec: SearchSpecification, candidate: LeadRecord): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  let ok = true;
  const { hard } = spec;
  if (hard.governorate) {
    if (!candidate.governorate) { ok = false; reasons.push('المحافظة المطلوبة غير مثبتة بدليل.'); }
    else if (candidate.governorate !== hard.governorate) { ok = false; reasons.push(`المحافظة (${candidate.governorate}) لا تطابق المطلوب (${hard.governorate}).`); }
  }
  if (hard.city) {
    if (!candidate.city) { ok = false; reasons.push('المدينة المطلوبة غير مثبتة بدليل.'); }
    else if (candidate.city !== hard.city) { ok = false; reasons.push(`المدينة (${candidate.city}) لا تطابق المطلوب (${hard.city}).`); }
  }
  const occupationPool = [hard.occupations, hard.jobTitles, hard.industries].flat().map((v) => v.toLowerCase());
  if (occupationPool.length > 0) {
    const candidateOccupation = [candidate.occupation, candidate.job_title, candidate.industry]
      .filter(Boolean).map((v) => String(v).toLowerCase());
    const matches = candidateOccupation.some((c) => occupationPool.some((p) => c.includes(p) || p.includes(c)));
    if (candidateOccupation.length === 0) { ok = false; reasons.push('المهنة/الوظيفة المطلوبة غير مثبتة بدليل.'); }
    else if (!matches) { ok = false; reasons.push('المهنة/الوظيفة لا تطابق أيًا من المطلوب.'); }
  }
  // Contact availability, when requested, is a Hard Requirement (§2 example:
  // "وسيلة اتصال عامة أو مهنية متاحة"). Any one channel (phone or email,
  // public or professional) satisfies it — the user asked for reachability,
  // not a specific channel.
  if (spec.soft.contactPhone || spec.soft.contactEmail) {
    const hasPhone = Boolean(candidate.public_contact_phone || candidate.business_phone);
    const hasEmail = Boolean(candidate.public_email || candidate.business_email);
    if (!hasPhone && !hasEmail) { ok = false; reasons.push('لا توجد وسيلة اتصال عامة أو مهنية مؤكدة بدليل.'); }
  }
  return { ok, reasons };
}

// ---------------------------------------------------------------------------
// Deterministic fallback query generation (§6) — used only as a seed for
// round 1 and as a safety fallback when the AI Gateway is unavailable for
// a round (never as a silent substitute for AI judgement — see
// `strategy_source` on every round in LoopOutput.rounds).
// ---------------------------------------------------------------------------

const LOCATION_VARIANTS: Record<string, string[]> = {
  'الغربية': ['Gharbia', 'Gharbeya'],
  'طنطا': ['Tanta'],
  'القاهرة': ['Cairo'],
  'الجيزة': ['Giza'],
  'الإسكندرية': ['Alexandria'],
  'المنصورة': ['Mansoura'],
  'الدقهلية': ['Dakahlia'],
  'المنوفية': ['Monufia'],
  'القليوبية': ['Qalyubia'],
};

const OCCUPATION_VARIANTS: Record<string, string[]> = {
  'مهنة حرة': ['أعمال حرة', 'صاحب عمل', 'Freelancer', 'Self-employed', 'Business owner'],
  'وظيفة إدارية': ['موظف إداري', 'إداري', 'Administrative', 'Manager', 'Office manager'],
  'محاسب': ['محاسبة', 'Accountant', 'Accounting'],
  'مهندس': ['مهندسة', 'Engineer'],
  'طبيب': ['طبيبة', 'دكتور', 'Doctor', 'Physician'],
  'تاجر': ['صاحب متجر', 'Merchant', 'Trader'],
  'مدرس': ['معلم', 'Teacher'],
  'محامي': ['محامية', 'Lawyer', 'Attorney'],
};

function expand(term: string, dictionary: Record<string, string[]>): string[] {
  const variants = new Set<string>([term]);
  const lower = term.trim();
  for (const [key, values] of Object.entries(dictionary)) {
    if (lower === key || lower.includes(key) || key.includes(lower)) {
      values.forEach((v) => variants.add(v));
    }
  }
  return Array.from(variants);
}

export type SearchModeName = 'fast' | 'balanced' | 'deep';

const MODE_QUERY_BUDGET: Record<SearchModeName, number> = { fast: 3, balanced: 5, deep: 8 };
const MODE_VERIFY_BUDGET: Record<SearchModeName, number> = { fast: 0, balanced: 3, deep: 8 };

export function generateQueries(spec: SearchSpecification, mode: SearchModeName): string[] {
  const locations = [spec.hard.city, spec.hard.governorate].filter(Boolean) as string[];
  const locationTerms = locations.length > 0
    ? locations.flatMap((loc) => expand(loc, LOCATION_VARIANTS))
    : [''];

  const occupationSources = [...spec.hard.occupations, ...spec.hard.jobTitles, ...spec.hard.industries];
  const occupationTerms = occupationSources.length > 0
    ? occupationSources.flatMap((o) => expand(o, OCCUPATION_VARIANTS))
    : [''];

  const queries: string[] = [];
  for (const loc of locationTerms) {
    for (const occ of occupationTerms) {
      const parts = [occ, loc].filter(Boolean);
      if (parts.length > 0) queries.push(parts.join(' '));
    }
  }
  const deduped = Array.from(new Set(queries.length > 0 ? queries : [spec.objective]));
  return deduped.slice(0, MODE_QUERY_BUDGET[mode]);
}

// ---------------------------------------------------------------------------
// Research Plan (§5)
// ---------------------------------------------------------------------------

export type ResearchPlan = {
  mode: SearchModeName;
  targetCount: number;
  maxRounds: number;
  steps: string[];
  stopCriteria: string[];
};

export function buildResearchPlan(spec: SearchSpecification, mode: SearchModeName, maxRounds: number): ResearchPlan {
  const location = [spec.hard.city, spec.hard.governorate].filter(Boolean).join('، ') || 'غير محدد';
  const occupation = [...spec.hard.occupations, ...spec.hard.jobTitles, ...spec.hard.industries].join('، ') || 'غير محدد';
  return {
    mode,
    targetCount: spec.requestedCount,
    maxRounds,
    steps: [
      `الهدف: العثور على ${spec.requestedCount} عميلًا محتملًا بأعلى جودة ممكنة (وليس بالضرورة كل العدد).`,
      `النطاق الجغرافي (Hard): ${location}.`,
      `المهنة/الوظيفة (Hard): ${occupation}.`,
      `المعايير الثانوية (Soft): العمر ${spec.soft.ageMin ?? '؟'}-${spec.soft.ageMax ?? '؟'}، وسيلة اتصال متاحة: ${spec.soft.contactPhone ? 'هاتف' : ''}${spec.soft.contactEmail ? ' وبريد' : ''}، حد أدنى للجودة: ${spec.soft.qualityMin}.`,
      `في كل جولة: يقرر AI الاستعلامات بنفسه بناءً على ما تعلّمه من الجولة السابقة، وليس بتوليد ثابت.`,
      `تنفيذ حتى ${maxRounds} جولة عبر المصادر المفعّلة والمهيأة فقط؛ أي مصدر غير مهيأ يُسجَّل كـ NOT_CONFIGURED.`,
      `بعد كل جولة: قراءة النتائج فعليًا عبر AI، استخراج المرشحين، التحقق من الأقوى، إزالة التكرار، فحص المطابقة والجودة، ثم قرار AI: متابعة / تعديل الاستراتيجية / توقف.`,
      `التوقف عند: الوصول للعدد المطلوب بجودة عالية، أو ثبات/تراجع الجودة (Quality Plateau)، أو قرار AI بعدم وجود استراتيجية جديدة مفيدة، أو استنفاد المصادر، أو انتهاء ميزانية البحث (جولات/وقت).`,
    ],
    stopCriteria: ['target_reached', 'quality_plateau', 'ai_decided_stop', 'sources_exhausted', 'max_rounds_reached', 'time_budget_exhausted', 'NOT_CONFIGURED'],
  };
}

// ---------------------------------------------------------------------------
// Source Connector contract (§20, §22) — tools, not the brain.
// ---------------------------------------------------------------------------

export type RawCandidate = Record<string, unknown> & { source_url?: string; evidence?: string };

// Credentials are passed per-call, never held as connector/module state —
// a connector instance is shared across every workspace's job in this
// isolate, and API keys must never leak across a concurrent job boundary.
export type SourceCredentials = { apiKey: string | null; baseUrl?: string | null };

export interface LeadSourceConnector {
  readonly key: string;
  search(query: string, spec: SearchSpecification, credentials: SourceCredentials, options?: SearchExecutionOptions): Promise<RawCandidate[]>;
  fetchPublicPage?(url: string): Promise<{ text: string; finalUrl: string } | null>;
  healthCheck?(credentials: SourceCredentials): Promise<{ status: string; message: string }>;
  normalize(record: RawCandidate): Promise<LeadRecord>;
  validate(record: LeadRecord): Promise<{ valid: boolean; errors: string[] }>;
}

export const CONNECTOR_REGISTRY: Map<string, LeadSourceConnector> = new Map();

// ---------------------------------------------------------------------------
// AI Gateway bridge — injected by index.ts (§1, §4, §10, §15, §18, §19).
// researchAgent.ts never builds an HTTP request itself; it only asks for a
// decision and reads back structured JSON, or null if the AI is down.
// ---------------------------------------------------------------------------

export type AIStep = 'plan_round' | 'extract_candidates' | 'verify_candidate' | 'round_review';

export type AICaller = (step: AIStep, payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;

export type SearchExecutionOptions = {
  query?: string;
  language?: string;
  page?: number;
  time_range?: string | null;
  categories?: string[];
  engines?: string[];
  safe_search?: number | boolean;
};

export type ResearchToolCall = {
  id?: string;
  name: 'search_web' | 'fetch_public_page';
  arguments: Record<string, unknown>;
};

export type ResearchToolResult = {
  id: string;
  name: ResearchToolCall['name'];
  ok: boolean;
  source?: string;
  query?: string;
  result_count?: number;
  results?: RawCandidate[];
  page?: { text: string; finalUrl: string } | null;
  error?: string;
};

export type PlanRoundDecision = {
  strategy?: string;
  queries: string[];
  categories?: string[];
  engines?: string[];
  language?: string;
  time_range?: string | null;
  reason?: string;
  target_information?: string[];
  expected_result_type?: string;
  next_action?: string;
  reasoning: string;
  deprioritized_queries?: string[];
  tool_calls?: ResearchToolCall[];
};

export type ExtractedCandidate = {
  is_candidate_person: boolean;
  raw: Partial<RawLeadInput>;
  evidence: Array<{ field: string; source_url: string; snippet: string }>;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
};

export type VerifyDecision = {
  verdict: 'confirmed' | 'conflict' | 'unknown';
  reasoning: string;
};

export type RoundReviewDecision = {
  decision: 'continue' | 'stop';
  next_action?: 'CONTINUE_SAME_STRATEGY' | 'REFINE_QUERY' | 'CHANGE_STRATEGY' | 'CHANGE_CATEGORY' | 'CHANGE_ENGINE' | 'VERIFY' | 'SEARCH_MISSING_FIELD' | 'STOP' | string;
  stop_reason?: string;
  quality_signal: 'improving' | 'stable' | 'declining';
  note: string;
};

// ---------------------------------------------------------------------------
// The Research Loop (§1, §7, §14, §15, §18, §19, §24)
// ---------------------------------------------------------------------------

export type SourceRoundStat = {
  round: number;
  source: string;
  status: 'ok' | 'not_configured' | 'error' | 'rate_limited' | 'timeout' | 'source_error' | 'no_results' | 'permission_error';
  query?: string;
  records_found: number;
  error?: string;
};

export type CandidateLedgerEntry = {
  source_id: string; // connector_key, used by index.ts to resolve the lead_sources row
  external_id: string; // stable hash of source_url used for lead_source_records.external_id
  source_url: string | null;
  raw_record: Record<string, unknown>;
  extraction_status: 'collected' | 'normalized' | 'validated' | 'rejected' | 'failed';
  validation_error: string | null;
  normalized_lead: LeadRecord | null;
};

export type RoundStrategyNote = {
  round: number;
  strategy_source: 'ai' | 'fallback_deterministic';
  queries: string[];
  reasoning: string;
  strategy?: string;
  categories?: string[];
  engines?: string[];
  language?: string;
  time_range?: string | null;
  next_action?: string;
  found: number;
  qualified: number;
  rejected: number;
  duplicates: number;
  review: RoundReviewDecision | null;
};

export type LoopInput = {
  spec: SearchSpecification;
  mode: SearchModeName;
  maxRounds: number;
  maxQueries: number;
  maxFetches: number;
  maxCandidatesPerRound: number;
  maxRuntimeMs: number;
  sources: Array<{ source_id?: string; connector_key: string; enabled: boolean; apiKey: string | null; baseUrl?: string | null }>;
  isDuplicate: (candidate: LeadRecord) => Promise<boolean>;
  aiCall: AICaller;
  onProgress?: (stage: string, percent: number) => Promise<void>;
  searchConstraints?: { categories?: string[]; languages?: string[]; engines?: string[]; allowSocialSearch?: boolean; allowSiteSearch?: boolean; defaultTimeRange?: string | null };
  sourceCapabilities?: Record<string, Record<string, unknown>>;
};

export type LoopOutput = {
  accepted: Array<{ lead: LeadRecord; dataQuality: { score: number; reasons: string[] }; score: { score: number; priority: string; reasons: string[] }; evidence: Array<{ field: string; source_url: string; snippet: string; verified?: boolean }> }>;
  candidateLedger: CandidateLedgerEntry[];
  queriesUsed: string[];
  roundsCompleted: number;
  stopReason: string;
  sourceStats: SourceRoundStat[];
  strategyNotes: RoundStrategyNote[];
  searchMemory: Record<string, unknown>;
  searchSummary: Record<string, unknown>;
  toolCalls: ResearchToolCall[];
  toolResults: ResearchToolResult[];
  totals: { found: number; duplicates: number; rejected: number; qualified: number; verified: number; verificationConflicts: number };
};

function externalIdFor(url: string | undefined, index: number): string {
  if (!url) return `no-url-${index}-${Date.now()}`;
  try {
    return url.slice(0, 500);
  } catch {
    return `hash-${index}-${Date.now()}`;
  }
}

function safePublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (host === 'localhost' || host.endsWith('.local') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizedToolCall(value: unknown): ResearchToolCall | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const name = row.name === 'search_web' || row.name === 'fetch_public_page' ? row.name : null;
  if (!name) return null;
  const rawArgs = row.arguments && typeof row.arguments === 'object' ? row.arguments as Record<string, unknown> : {};
  return { id: typeof row.id === 'string' ? row.id.slice(0, 80) : undefined, name, arguments: rawArgs };
}

const AI_CALL_TIMEOUT_MS = 25_000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  if (timeoutMs <= 0) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function searchOptionsForTool(args: Record<string, unknown>, constraints: LoopInput['searchConstraints'], capabilities: LoopInput['sourceCapabilities']): SearchExecutionOptions {
  const caps = (capabilities?.searxng_search ?? {}) as Record<string, unknown>;
  const list = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  const requestedCategories = list(args.categories);
  const requestedEngines = list(args.engines);
  const availableCategories = list(caps.categories);
  const availableEngines = list(caps.engines);
  const categories = caps.categoriesKnown === true && requestedCategories.length ? requestedCategories.filter((item) => availableCategories.includes(item)) : undefined;
  const engines = caps.enginesKnown === true && requestedEngines.length ? requestedEngines.filter((item) => availableEngines.includes(item)) : undefined;
  const requestedLanguage = typeof args.language === 'string' ? args.language : undefined;
  const language = caps.languagesKnown === true && list(caps.languages).includes(requestedLanguage ?? '') ? requestedLanguage : caps.languagesKnown === true ? constraints?.languages?.[0] : undefined;
  const timeRange = caps.timeRangeKnown === true && typeof args.time_range === 'string' ? args.time_range : caps.timeRangeKnown === true ? constraints?.defaultTimeRange ?? undefined : undefined;
  return { categories: categories?.length ? categories.slice(0, 3) : undefined, engines: engines?.length ? engines.slice(0, 5) : undefined, language, time_range: timeRange, safe_search: 1 };
}

export async function runResearchLoop(input: LoopInput): Promise<LoopOutput> {
  const { spec, mode } = input;
  const startedAt = Date.now();
  const hardDeadline = startedAt + Math.max(30_000, input.maxRuntimeMs);
  const isPastDeadline = () => Date.now() >= hardDeadline;
  const callAi = async <T extends Record<string, unknown>>(step: AIStep, payload: Record<string, unknown>): Promise<T | null> => {
    if (isPastDeadline()) return null;
    const remaining = hardDeadline - Date.now();
    return await withTimeout(input.aiCall(step, payload), Math.min(AI_CALL_TIMEOUT_MS, remaining)) as T | null;
  };
  const enabledSources = input.sources.filter((s) => s.enabled);
  const sourceStats: SourceRoundStat[] = [];
  const queriesUsed: string[] = [];
  const accepted: LoopOutput['accepted'] = [];
  const candidateLedger: CandidateLedgerEntry[] = [];
  const strategyNotes: RoundStrategyNote[] = [];
  const toolCalls: ResearchToolCall[] = [];
  const toolResults: ResearchToolResult[] = [];
  const totals = { found: 0, duplicates: 0, rejected: 0, qualified: 0, verified: 0, verificationConflicts: 0 };
  const queryPerformance: Record<string, { issued: number; qualified: number; rejected: number }> = {};
  const rejectedReasons: string[] = [];
  const missingFields = new Set<string>();
  const sourcesUsed = new Set<string>();
  const strategiesUsed = new Set<string>();
  const categoriesUsed = new Set<string>();
  const enginesUsed = new Set<string>();
  const successfulQueries: string[] = [];
  const weakQueries: string[] = [];
  const aiProvidersUsed = new Set<string>();
  const aiModelsUsed = new Set<string>();
  const aiFallbackLog: Array<{ provider: string; model: string; error: string }> = [];
  let aiFallbacks = 0;
  const trackAi = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const meta = value as Record<string, unknown>;
    if (typeof meta.__ai_provider === 'string' && meta.__ai_provider) aiProvidersUsed.add(meta.__ai_provider);
    if (typeof meta.__ai_model === 'string' && meta.__ai_model) aiModelsUsed.add(meta.__ai_model);
    aiFallbacks += Number(meta.__ai_fallback_count ?? 0) || 0;
    if (Array.isArray(meta.__ai_fallback_log)) {
      for (const item of meta.__ai_fallback_log) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Record<string, unknown>;
        const provider = String(row.provider ?? 'unknown');
        const model = String(row.model ?? 'unknown');
        const error = String(row.error ?? 'unknown');
        if (!aiFallbackLog.some((entry) => entry.provider === provider && entry.model === model && entry.error === error)) aiFallbackLog.push({ provider, model, error });
      }
    }
  };
  let fetchesUsed = 0;
  let queriesIssued = 0;
  let previousRoundQuality = 0;

  const anyConnectorAvailable = enabledSources.some((s) => CONNECTOR_REGISTRY.has(s.connector_key));
  if (!anyConnectorAvailable) {
    for (const source of enabledSources) {
      sourceStats.push({ round: 0, source: source.connector_key, status: 'not_configured', records_found: 0, error: 'المصدر غير مهيأ لهذا النوع من البيانات.' });
    }
    return {
      accepted, candidateLedger, queriesUsed, roundsCompleted: 0, stopReason: 'NOT_CONFIGURED', sourceStats, strategyNotes,
      searchMemory: { sourcesUsed: [], strategiesUsed: [], candidatesSeen: 0, rejectedCandidates: 0, rejectionReasons: [], verifiedCandidates: 0, duplicates: 0, missingFields: [], successfulQueries: [], weakQueries: [], searchRounds: 0, toolCalls: [], toolResults: [] },
      searchSummary: { requested: spec.requestedCount, candidates: 0, verified: 0, qualified: 0, rejected: 0, duplicates: 0, averageMatchScore: null, averageDataQuality: null, sourcesUsed: [], searchRounds: 0, toolCalls: [], toolResults: [] },
      toolCalls, toolResults, totals,
    };
  }

  let round = 0;
  let previousRoundQualified = Infinity;
  let previousReview: RoundReviewDecision | null = null;
  let stopReason = 'max_rounds_reached';
  const seedQueries = generateQueries(spec, mode);

  while (round < input.maxRounds && accepted.length < spec.requestedCount) {
    if (isPastDeadline()) { stopReason = 'time_budget_exhausted'; break; }
    if (queriesIssued >= input.maxQueries) { stopReason = 'search_budget_exhausted'; break; }
    round += 1;
    await input.onProgress?.('planning', Math.min(20 + round * 4, 30));

    // --- PLAN (§1 THINK/PLAN, §15 learn from previous round) ---
    const planDecision = await callAi<PlanRoundDecision>('plan_round', {
      spec, mode, round, requestedCount: spec.requestedCount,
      alreadyQualified: accepted.length,
      seedQueries,
      queriesUsedSoFar: queriesUsed,
      queryPerformance,
      previousReview,
      searchConstraints: input.searchConstraints ?? {},
      sourceCapabilities: input.sourceCapabilities ?? {},
    });

    trackAi(planDecision);
    let effectivePlanDecision = planDecision;
    const toolRawByKey = new Map<string, RawCandidate[]>();
    const fetchedPagesByUrl = new Map<string, { text: string; finalUrl: string }>();
    const roundToolResults: ResearchToolResult[] = [];
    const requestedTools = (planDecision?.tool_calls ?? []).map(normalizedToolCall).filter((item): item is ResearchToolCall => item !== null).slice(0, 4);
    let toolSearchesIssued = 0;
    for (const toolCall of requestedTools) {
      toolCalls.push(toolCall);
      const args = toolCall.arguments;
      const requestedSource = typeof args.source === 'string' ? args.source : 'serper_search';
      const source = enabledSources.find((item) => item.connector_key === requestedSource) ?? enabledSources.find((item) => item.connector_key === 'serper_search') ?? enabledSources[0];
      const connector = source ? CONNECTOR_REGISTRY.get(source.connector_key) : undefined;
      if (!source || !connector) {
        const result: ResearchToolResult = { id: toolCall.id ?? `tool-${toolCalls.length}`, name: toolCall.name, ok: false, source: requestedSource, error: 'لا يوجد مصدر Web مفعّل لهذا الطلب.' };
        roundToolResults.push(result); toolResults.push(result); continue;
      }
      if (toolCall.name === 'search_web') {
        const query = typeof args.query === 'string' ? args.query.trim().slice(0, 500) : '';
        if (!query || queriesIssued + toolSearchesIssued >= input.maxQueries) {
          const result: ResearchToolResult = { id: toolCall.id ?? `tool-${toolCalls.length}`, name: toolCall.name, ok: false, source: source.connector_key, query, error: !query ? 'أداة البحث تحتاج query نصيًا.' : 'تم استنفاد ميزانية البحث.' };
          roundToolResults.push(result); toolResults.push(result); continue;
        }
        toolSearchesIssued += 1;
        try {
          const raw = (await connector.search(query, spec, { apiKey: source.apiKey, baseUrl: source.baseUrl }, source.connector_key === 'searxng_search' ? searchOptionsForTool(args, input.searchConstraints, input.sourceCapabilities) : undefined)).slice(0, input.maxCandidatesPerRound);
          toolRawByKey.set(`${source.connector_key}::${query}`, raw);
          const result: ResearchToolResult = { id: toolCall.id ?? `tool-${toolCalls.length}`, name: toolCall.name, ok: true, source: source.connector_key, query, result_count: raw.length, results: raw.slice(0, 25) };
          roundToolResults.push(result); toolResults.push(result);
        } catch (error) {
          const result: ResearchToolResult = { id: toolCall.id ?? `tool-${toolCalls.length}`, name: toolCall.name, ok: false, source: source.connector_key, query, error: error instanceof Error ? error.message : 'تعذر تنفيذ Web Search.' };
          roundToolResults.push(result); toolResults.push(result);
        }
      } else {
        const url = safePublicUrl(args.url);
        if (!url || !connector.fetchPublicPage || fetchesUsed >= input.maxFetches) {
          const result: ResearchToolResult = { id: toolCall.id ?? `tool-${toolCalls.length}`, name: toolCall.name, ok: false, source: source.connector_key, error: !url ? 'الرابط ليس Public HTTP(S).' : fetchesUsed >= input.maxFetches ? 'تم استنفاد ميزانية fetch.' : 'المصدر لا يدعم fetch_public_page.' };
          roundToolResults.push(result); toolResults.push(result); continue;
        }
        fetchesUsed += 1;
        const page = await connector.fetchPublicPage(url);
        if (page) fetchedPagesByUrl.set(url, page);
        const result: ResearchToolResult = { id: toolCall.id ?? `tool-${toolCalls.length}`, name: toolCall.name, ok: Boolean(page), source: source.connector_key, page, error: page ? undefined : 'تعذر قراءة الصفحة العامة.' };
        roundToolResults.push(result); toolResults.push(result);
      }
    }
    if (roundToolResults.length > 0) {
      const followUp = await callAi<PlanRoundDecision>('plan_round', { spec, mode, round, requestedCount: spec.requestedCount, alreadyQualified: accepted.length, seedQueries, queriesUsedSoFar: queriesUsed, queryPerformance, previousReview, searchConstraints: input.searchConstraints ?? {}, sourceCapabilities: input.sourceCapabilities ?? {}, tool_results: roundToolResults, tool_execution_complete: true });
      trackAi(followUp);
      if (followUp && Array.isArray((followUp as PlanRoundDecision).queries) && (followUp as PlanRoundDecision).queries.length > 0) effectivePlanDecision = followUp as PlanRoundDecision;
    }
    const planningDecision = effectivePlanDecision;
    const strategySource: 'ai' | 'fallback_deterministic' = planningDecision?.queries?.length ? 'ai' : 'fallback_deterministic';
    const capabilities = (input.sourceCapabilities?.searxng_search ?? {}) as Record<string, unknown>;
    const constraints = input.searchConstraints ?? {};
    const knownList = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];
    const allowedValues = (requested: unknown, allowed: unknown, known: boolean): string[] | undefined => {
      if (!known || !Array.isArray(requested)) return undefined;
      const available = knownList(allowed);
      const constrained = available.filter((value) => (requested as unknown[]).map(String).includes(value));
      return constrained.length ? constrained : undefined;
    };
    const plannedCategories = allowedValues(planningDecision?.categories, capabilities.categories, capabilities.categoriesKnown === true);
    const plannedEngines = allowedValues(planningDecision?.engines, capabilities.engines, capabilities.enginesKnown === true);
    const plannedLanguage = capabilities.languagesKnown === true && knownList(capabilities.languages).includes(String(planningDecision?.language ?? '')) ? String(planningDecision?.language) : undefined;
    const plannedTimeRange = capabilities.timeRangeKnown === true && planningDecision?.time_range ? String(planningDecision.time_range) : undefined;
    plannedCategories?.forEach((value) => categoriesUsed.add(value));
    plannedEngines?.forEach((value) => enginesUsed.add(value));
    const searchOptions: SearchExecutionOptions = {
      language: plannedLanguage ?? (capabilities.languagesKnown === true && constraints.languages?.length ? constraints.languages[0] : undefined),
      time_range: plannedTimeRange ?? (capabilities.timeRangeKnown === true ? constraints.defaultTimeRange ?? undefined : undefined),
      categories: plannedCategories,
      engines: plannedEngines,
      safe_search: 1,
    };
    const toolQueries = roundToolResults.filter((item) => item.ok && item.name === 'search_web' && item.query).map((item) => String(item.query));
    const plannedQueries = [...(strategySource === 'ai' ? planningDecision!.queries : seedQueries), ...toolQueries];
    const roundQueries = plannedQueries
      .filter((q) => typeof q === 'string' && q.trim().length > 0)
      .filter((q, index, all) => all.indexOf(q) === index && !queriesUsed.includes(q))
      .slice(0, Math.min(MODE_QUERY_BUDGET[mode], input.maxQueries - queriesIssued));
    strategiesUsed.add(strategySource === 'ai' ? 'ai_adaptive' : 'deterministic_seed');
    roundQueries.forEach((q) => { if (queryPerformance[q]?.qualified > 0) successfulQueries.push(q); });
    const reasoning = planningDecision?.reasoning ?? 'استعلامات احتياطية ثابتة (AI Gateway غير متاح لهذه الجولة).';

    const roundStartAccepted = accepted.length;
    let roundQualified = 0;
    let roundRejected = 0;
    let roundDuplicates = 0;
    let roundFound = 0;

    // --- SEARCH + OBSERVE (§1 SEARCH/OBSERVE, real tool calls) ---
    for (const query of roundQueries) {
      if (isPastDeadline()) { stopReason = 'time_budget_exhausted'; break; }
      if (queriesIssued >= input.maxQueries) { stopReason = 'search_budget_exhausted'; break; }
      queriesIssued += 1;
      queriesUsed.push(query);
      queryPerformance[query] ??= { issued: 0, qualified: 0, rejected: 0 };
      queryPerformance[query].issued += 1;

      await input.onProgress?.('searching', Math.min(35 + round * 5, 55));
      for (const source of enabledSources) {
        if (isPastDeadline()) { stopReason = 'time_budget_exhausted'; break; }
        const connector = CONNECTOR_REGISTRY.get(source.connector_key);
        sourcesUsed.add(source.connector_key);
        if (!connector) {
          sourceStats.push({ round, source: source.connector_key, status: 'not_configured', records_found: 0, error: 'المصدر غير مهيأ.' });
          continue;
        }
        let raw: RawCandidate[] = [];
        try {
          raw = (toolRawByKey.get(`${source.connector_key}::${query}`) ?? (await connector.search(query, spec, { apiKey: source.apiKey, baseUrl: source.baseUrl }, source.connector_key === 'searxng_search' ? searchOptions : undefined))).slice(0, input.maxCandidatesPerRound);
          if (raw.length > 0) successfulQueries.push(query);
          else weakQueries.push(query);
          // Do not fetch every SERP result automatically. Public pages are
          // fetched only when the AI explicitly requests fetch_public_page;
          // otherwise a single round can spend minutes opening 5 pages per
          // query before extraction even begins.
          for (const result of raw) {
            if (!result.source_url) continue;
            const fetched = fetchedPagesByUrl.get(String(result.source_url));
            if (fetched?.text) result._public_page_text = fetched.text;
          }
          sourceStats.push({ round, source: source.connector_key, status: raw.length > 0 ? 'ok' : 'no_results', query, records_found: raw.length });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'تعذر الوصول إلى المصدر.';
          const errorCode = (error as { code?: string })?.code;
          const status = errorCode === 'NOT_CONFIGURED' ? 'not_configured' : errorCode === 'RATE_LIMITED' ? 'rate_limited' : errorCode === 'TIMEOUT' ? 'timeout' : errorCode === 'PERMISSION_ERROR' ? 'permission_error' : 'source_error';
          sourceStats.push({ round, source: source.connector_key, status, query, records_found: 0, error: message });
          weakQueries.push(query);
          continue;
        }
        roundFound += raw.length;
        totals.found += raw.length;
        if (raw.length === 0) continue;

        // --- ANALYZE / READ (§1 ANALYZE, §4, §9 evidence-based extraction) ---
        await input.onProgress?.('analyzing', Math.min(55 + round * 4, 68));
        const extraction = await callAi<{ candidates: ExtractedCandidate[] } & Record<string, unknown>>('extract_candidates', { spec, results: raw });
        trackAi(extraction);
        if (!extraction?.candidates?.length) {
          // AI unavailable or found nothing extractable — every raw result is
          // still logged as a collected-but-unprocessed candidate (§7:
          // Candidate ≠ Lead), never silently promoted.
          raw.forEach((r, i) => {
            candidateLedger.push({
              source_id: source.connector_key,
              external_id: externalIdFor(r.source_url, i),
              source_url: (r.source_url as string) ?? null,
              raw_record: { ...r, extraction: 'unavailable' },
              extraction_status: 'collected',
              validation_error: extraction ? 'لم يتعرف AI على مرشحين فعليين في هذه النتائج.' : 'تعذر الوصول إلى AI Gateway لاستخراج المرشحين.',
              normalized_lead: null,
            });
            rejectedReasons.push(extraction ? 'لم يتعرف AI على مرشحين فعليين.' : 'AI Gateway غير متاح للاستخراج.');
          });
          continue;
        }

        for (let i = 0; i < extraction.candidates.length; i++) {
          if (isPastDeadline()) { stopReason = 'time_budget_exhausted'; break; }
          const item = extraction.candidates[i];
          const sourceRow = raw[i];
          const ledgerEntry: CandidateLedgerEntry = {
            source_id: source.connector_key,
            external_id: externalIdFor(sourceRow?.source_url as string | undefined, i),
            source_url: (sourceRow?.source_url as string) ?? null,
            raw_record: { serp: sourceRow, extraction: item },
            extraction_status: 'collected',
            validation_error: null,
            normalized_lead: null,
          };

          if (!item.is_candidate_person) {
            ledgerEntry.extraction_status = 'rejected';
            ledgerEntry.validation_error = 'النتيجة ليست فردًا (شركة/صفحة عامة/غير ذلك).';
            candidateLedger.push(ledgerEntry);
            rejectedReasons.push(ledgerEntry.validation_error);
            totals.rejected += 1; roundRejected += 1; queryPerformance[query].rejected += 1;
            continue;
          }

          const meta: LeadIntakeMeta = { sourceType: 'search_engine', sourceId: source.source_id ?? null, sourceUrl: sourceRow?.source_url as string | undefined, collectedAt: new Date().toISOString() };
          const { normalized, formatIssues } = normalizeLead(item.raw as RawLeadInput, meta);
          const validation = validateLead(normalized, formatIssues);
          ledgerEntry.extraction_status = 'normalized';

          if (!validation.valid) {
            ledgerEntry.extraction_status = 'rejected';
            ledgerEntry.validation_error = validation.errors.join(' ');
            candidateLedger.push(ledgerEntry);
            rejectedReasons.push(ledgerEntry.validation_error);
            totals.rejected += 1; roundRejected += 1; queryPerformance[query].rejected += 1;
            continue;
          }

          const hardCheck = meetsHardRequirements(spec, normalized);
          if (!hardCheck.ok) {
            ledgerEntry.extraction_status = 'rejected';
            ledgerEntry.validation_error = hardCheck.reasons.join(' ');
            candidateLedger.push(ledgerEntry);
            rejectedReasons.push(ledgerEntry.validation_error);
            hardCheck.reasons.forEach((reason) => { if (/غير مثبتة|لا توجد/.test(reason)) missingFields.add(reason); });
            totals.rejected += 1; roundRejected += 1; queryPerformance[query].rejected += 1;
            continue;
          }

          if (await input.isDuplicate(normalized)) {
            ledgerEntry.extraction_status = 'rejected';
            ledgerEntry.validation_error = 'مكرر — يطابق عميلًا موجودًا بالفعل.';
            candidateLedger.push(ledgerEntry);
            rejectedReasons.push(ledgerEntry.validation_error);
            totals.duplicates += 1; roundDuplicates += 1;
            continue;
          }

          // --- VERIFY (§1 VERIFY, §10) — only for candidates that would
          // otherwise be accepted, and only up to the mode's verify budget.
          await input.onProgress?.('verifying', Math.min(68 + round * 3, 78));
          let verified: VerifyDecision | null = null;
          const verifyBudgetLeft = MODE_VERIFY_BUDGET[mode] - totals.verified;
          if (verifyBudgetLeft > 0 && item.confidence !== 'high') {
            const connectorForVerify = CONNECTOR_REGISTRY.get(source.connector_key);
            let corroboration: RawCandidate[] = [];
            if (connectorForVerify && normalized.full_name) {
              const verifyQuery = [normalized.full_name, normalized.governorate ?? normalized.city].filter(Boolean).join(' ');
              try { corroboration = (await connectorForVerify.search(verifyQuery, spec, { apiKey: source.apiKey, baseUrl: source.baseUrl })).slice(0, 5); } catch { /* leave empty — verification stays inconclusive */ }
              for (const otherSource of enabledSources) {
                if (otherSource.connector_key === source.connector_key) continue;
                const otherConnector = CONNECTOR_REGISTRY.get(otherSource.connector_key);
                if (!otherConnector) continue;
                try {
                  const additional = await otherConnector.search(verifyQuery, spec, { apiKey: otherSource.apiKey, baseUrl: otherSource.baseUrl });
                  corroboration = [...corroboration, ...additional.slice(0, 5)];
                } catch { /* failover source is optional */ }
              }
            }
            verified = await callAi<VerifyDecision & Record<string, unknown>>('verify_candidate', { spec, candidate: normalized, evidence: item.evidence, corroboration });
            trackAi(verified);
            totals.verified += 1;
            if (verified?.verdict !== 'confirmed') {
              if (verified?.verdict === 'conflict') totals.verificationConflicts += 1;
              ledgerEntry.extraction_status = 'rejected';
              ledgerEntry.validation_error = verified?.verdict === 'conflict' ? `تعارض في التحقق: ${verified.reasoning}` : 'لم يمكن تأكيد هوية المرشح من Evidence إضافية.';
              candidateLedger.push(ledgerEntry);
              rejectedReasons.push(ledgerEntry.validation_error);
              totals.rejected += 1; roundRejected += 1; queryPerformance[query].rejected += 1;
              continue;
            }
          }

          const dataQuality = dataQualityAssessment(normalized);
          if (dataQuality.score < spec.soft.qualityMin) {
            ledgerEntry.extraction_status = 'rejected';
            ledgerEntry.validation_error = `جودة البيانات (${dataQuality.score}) أقل من الحد الأدنى (${spec.soft.qualityMin}).`;
            candidateLedger.push(ledgerEntry);
            rejectedReasons.push(ledgerEntry.validation_error);
            totals.rejected += 1; roundRejected += 1; queryPerformance[query].rejected += 1;
            continue;
          }

          const ageMatch = normalized.age !== null && normalized.age !== undefined && (spec.soft.ageMin === undefined || Number(normalized.age) >= spec.soft.ageMin) && (spec.soft.ageMax === undefined || Number(normalized.age) <= spec.soft.ageMax);
          const evidenceStrength = Math.min(100, (item.evidence?.length ?? 0) * 25 + (item.confidence === 'high' ? 25 : item.confidence === 'medium' ? 10 : 0));
          const score = scoreLeadIntake({ ...normalized, data_quality_score: dataQuality.score }, { ageMatch: spec.soft.ageMin !== undefined || spec.soft.ageMax !== undefined ? ageMatch : null, evidenceStrength });
          Object.entries(normalized).forEach(([field, value]) => { if (value === null || value === undefined || value === '') missingFields.add(field); });
          ledgerEntry.extraction_status = 'validated';
          ledgerEntry.normalized_lead = normalized;
          candidateLedger.push(ledgerEntry);
          accepted.push({ lead: normalized, dataQuality, score, evidence: item.evidence ?? [] });
          totals.qualified += 1; roundQualified += 1; queryPerformance[query].qualified += 1;
        }
      }
    }

    if (isPastDeadline()) { stopReason = 'time_budget_exhausted'; break; }

    // --- REVIEW / ADAPT / STOP (§1 REVIEW/STOP, §14, §19 quality plateau) ---
    await input.onProgress?.('final_review', Math.min(82 + round * 3, 92));
    const roundAccepted = accepted.slice(roundStartAccepted);
    const roundQuality = roundAccepted.length > 0 ? roundAccepted.reduce((sum, item) => sum + item.dataQuality.score, 0) / roundAccepted.length : 0;
    const review = await callAi<RoundReviewDecision & Record<string, unknown>>('round_review', {
      spec, round, roundFound, roundQualified, roundRejected, roundDuplicates,
      totalQualified: accepted.length, requestedCount: spec.requestedCount,
      previousRoundQualified: previousRoundQualified === Infinity ? null : previousRoundQualified,
    });
    trackAi(review);

    strategyNotes.push({
      round, strategy_source: strategySource, queries: roundQueries, reasoning,
      strategy: planningDecision?.strategy,
      categories: searchOptions.categories,
      engines: searchOptions.engines,
      language: searchOptions.language,
      time_range: searchOptions.time_range,
      next_action: review?.next_action,
      found: roundFound, qualified: roundQualified, rejected: roundRejected, duplicates: roundDuplicates,
      review,
    });

    if (accepted.length >= spec.requestedCount) { stopReason = 'target_reached'; break; }

    // Quality plateau is based on the actual data-quality signal, not only on
    // whether a round happened to produce zero records.
    if (round > 1 && previousRoundQuality > 0 && roundQuality < previousRoundQuality * 0.75) { stopReason = 'quality_plateau'; break; }
    if (roundQualified === 0 && previousRoundQualified === 0) { stopReason = 'quality_plateau'; break; }

    if (review?.decision === 'stop') { stopReason = review.stop_reason || 'ai_decided_stop'; break; }

    previousReview = review;
    previousRoundQualified = roundQualified;
    previousRoundQuality = roundQuality;
  }

  accepted.sort((a, b) => b.score.score - a.score.score);
  const averageMatchScore = accepted.length ? accepted.reduce((sum, item) => sum + item.score.score, 0) / accepted.length : null;
  const averageDataQuality = accepted.length ? accepted.reduce((sum, item) => sum + item.dataQuality.score, 0) / accepted.length : null;
  const searchMemory = {
    queriesUsed,
    sourcesUsed: Array.from(sourcesUsed),
    strategiesUsed: Array.from(strategiesUsed),
    categoriesUsed: Array.from(categoriesUsed),
    enginesUsed: Array.from(enginesUsed),
    sourceCapabilities: input.sourceCapabilities ?? {},
    candidatesSeen: totals.found,
    rejectedCandidates: totals.rejected,
    rejectionReasons: rejectedReasons.slice(0, 100),
    verifiedCandidates: totals.verified,
    duplicates: totals.duplicates,
    missingFields: Array.from(missingFields).slice(0, 100),
    successfulQueries: Array.from(new Set(successfulQueries)),
    weakQueries: Array.from(new Set(weakQueries)),
    searchRounds: round,
    fetchesUsed,
    queriesIssued,
    aiProvidersUsed: Array.from(aiProvidersUsed),
    aiModelsUsed: Array.from(aiModelsUsed),
    aiFallbacks,
    aiFallbackLog: aiFallbackLog.slice(0, 100),
    toolCalls: toolCalls.slice(0, 100),
    toolResults: toolResults.slice(0, 100),
  };
  const searchSummary = {
    requested: spec.requestedCount,
    candidates: totals.found,
    verified: totals.verified,
    qualified: accepted.length,
    rejected: totals.rejected,
    duplicates: totals.duplicates,
    averageMatchScore: averageMatchScore === null ? null : Math.round(averageMatchScore * 10) / 10,
    averageDataQuality: averageDataQuality === null ? null : Math.round(averageDataQuality * 10) / 10,
    sourcesUsed: Array.from(sourcesUsed),
    strategiesUsed: Array.from(strategiesUsed),
    categoriesUsed: Array.from(categoriesUsed),
    enginesUsed: Array.from(enginesUsed),
    sourceCapabilities: input.sourceCapabilities ?? {},
    strongQueries: Array.from(new Set(successfulQueries)),
    weakQueries: Array.from(new Set(weakQueries)),
    relevantRate: totals.found ? Math.round(((totals.found - totals.rejected) / totals.found) * 1000) / 10 : null,
    qualifiedRate: totals.found ? Math.round((totals.qualified / totals.found) * 1000) / 10 : null,
    duplicateRate: totals.found ? Math.round((totals.duplicates / totals.found) * 1000) / 10 : null,
    verificationRate: totals.verified ? Math.round(((totals.verified - totals.verificationConflicts) / totals.verified) * 1000) / 10 : null,
    searchRounds: round,
    stopReason,
    aiProvidersUsed: Array.from(aiProvidersUsed),
    aiModelsUsed: Array.from(aiModelsUsed),
    aiFallbacks,
    aiFallbackLog: aiFallbackLog.slice(0, 100),
    toolCalls: toolCalls.slice(0, 100),
    toolResults: toolResults.slice(0, 100),
  };
  return { accepted, candidateLedger, queriesUsed, roundsCompleted: round, stopReason, sourceStats, strategyNotes, searchMemory, searchSummary, toolCalls, toolResults, totals };

}
