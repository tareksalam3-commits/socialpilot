export type LeadSearchStatus = 'draft' | 'confirmed' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type LeadJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type LeadPriority = 'top' | 'high' | 'suitable' | 'low' | 'weak';

export type LeadSearchQuery = {
  location?: {
    country?: string;
    governorate?: string;
    city?: string;
    district?: string;
    radiusKm?: number;
  };
  age?: { min?: number; max?: number };
  gender?: string;
  occupations?: string[];
  jobTitles?: string[];
  industries?: string[];
  seniority?: string[];
  education?: string[];
  interests?: string[];
  professionalInformation?: string[];
  contactAvailability?: {
    phone?: boolean;
    email?: boolean;
  };
  freshness?: 'fresh' | 'verified' | 'stale' | 'very_stale' | 'unknown';
  qualityMin?: number;
  customerType: 'individual';
  objective: string;
  requestedCount: number;
};

export type LeadSearchAnalysis = {
  query: LeadSearchQuery;
  summary: Array<{ label: string; value: string }>;
  assumptions: string[];
  warnings: string[];
};

export type LeadSource = {
  id: string;
  workspace_id: string;
  name: string;
  connector_key: string;
  source_type: 'official_api' | 'public_directory' | 'professional_source' | 'owned_source' | 'lead_form';
  enabled: boolean;
  priority: number;
  rate_limit_per_minute: number | null;
  status: 'not_configured' | 'healthy' | 'degraded' | 'disabled' | 'error';
  config: Record<string, unknown>;
  last_health_at: string | null;
  last_error: string | null;
  records_found: number;
  created_at: string;
  updated_at: string;
};

export type LeadSearchJob = {
  id: string;
  workspace_id: string;
  search_request_id: string;
  status: LeadJobStatus;
  progress_percent: number;
  progress_stage: string;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  source_stats: Array<Record<string, unknown>>;
  queries_used?: string[];
  rounds_completed?: number;
  stop_reason?: string | null;
  strategy_notes?: Array<Record<string, unknown>>;
  search_memory?: Record<string, unknown>;
  search_summary?: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Lead = {
  id: string;
  workspace_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  age: number | null;
  gender: string | null;
  occupation: string | null;
  job_title: string | null;
  industry: string | null;
  employer: string | null;
  country: string | null;
  governorate: string | null;
  city: string | null;
  district: string | null;
  business_phone: string | null;
  public_contact_phone: string | null;
  business_email: string | null;
  public_email: string | null;
  professional_url: string | null;
  social_url: string | null;
  source_id: string | null;
  source_url: string | null;
  source_type: string | null;
  collected_at: string | null;
  last_verified_at: string | null;
  data_quality_score: number | null;
  lead_score: number | null;
  status: 'new' | 'qualified' | 'contacted' | 'converted' | 'suppressed' | 'invalid' | 'archived';
  consent_status: 'unknown' | 'not_required' | 'pending' | 'consented' | 'denied';
  do_not_contact: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadTag = {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  created_at: string;
};

export type LeadCampaign = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  search_criteria: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
  member_count?: number;
};

export type LeadCampaignMember = {
  id: string;
  workspace_id: string;
  campaign_id: string;
  lead_id: string;
  status: 'pending' | 'contacted' | 'qualified' | 'converted' | 'excluded';
  notes: string | null;
  created_at: string;
  lead?: Lead;
};

export type LeadListFilters = {
  search?: string;
  status?: Lead['status'];
  governorate?: string;
  city?: string;
  minQuality?: number;
  minScore?: number;
  tagId?: string;
  includeDoNotContact?: boolean;
};

export type LeadSortBy = 'updated_at' | 'lead_score' | 'data_quality_score';

export type LeadIntakeRawInput = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  age?: number | string | null;
  gender?: string | null;
  occupation?: string | null;
  job_title?: string | null;
  industry?: string | null;
  employer?: string | null;
  country?: string | null;
  governorate?: string | null;
  city?: string | null;
  district?: string | null;
  business_phone?: string | null;
  public_contact_phone?: string | null;
  business_email?: string | null;
  public_email?: string | null;
  professional_url?: string | null;
  social_url?: string | null;
  notes?: string | null;
};

export type LeadSearchStats = {
  totalFound: number;
  valid: number;
  duplicates: number;
  invalid: number;
  qualified: number;
  verified?: number;
  averageMatchScore?: number | null;
  averageDataQuality?: number | null;
  sourcesUsed?: string[];
  rounds?: number;
  stopReason?: string | null;
  aiProvidersUsed?: string[];
  aiModelsUsed?: string[];
  aiFallbacks?: number;
  aiFallbackLog?: Array<{ provider: string; model: string; error: string }>;
  strategiesUsed?: string[];
  categoriesUsed?: string[];
  enginesUsed?: string[];
  strongQueries?: string[];
  weakQueries?: string[];
  relevantRate?: number | null;
  qualifiedRate?: number | null;
  duplicateRate?: number | null;
  verificationRate?: number | null;
  sourceCapabilities?: Record<string, unknown>;
};

export const LEAD_JOB_STAGE_LABELS: Record<string, string> = {
  queued: 'في الانتظار',
  understanding: 'أفهم مواصفات العملاء...',
  planning: 'أحدد أفضل طرق البحث...',
  discovery: 'أكتشف المرشحين...',
  searching: 'أبحث في المصادر المناسبة...',
  analyzing: 'أحلل النتائج...',
  refinement: 'أغير استراتيجية البحث بناءً على النتائج...',
  investigation: 'أبحث عن البيانات الناقصة...',
  selecting_sources: 'اختيار المصادر',
  collecting: 'أجمع البيانات العامة...',
  cleaning: 'تنظيف البيانات',
  deduplicating: 'إزالة التكرارات',
  verifying: 'أتحقق من أفضل المرشحين عبر Evidence إضافية...',
  qualifying: 'أستبعد النتائج غير المطابقة...',
  ranking: 'أرتب أفضل العملاء...',
  final_review: 'أراجع النتيجة النهائية...',
  scoring: 'حساب درجات العملاء',
  completed: 'اكتمل',
  failed: 'فشل',
  not_configured: 'لا توجد مصادر بحث خارجي مهيأة بعد',
  no_source_configured: 'لم يتم تفعيل أي مصدر بيانات',
  quality_plateau: 'توقّف الباحث بسبب تراجع جودة النتائج',
  search_budget_exhausted: 'انتهت ميزانية البحث المحددة',
  time_budget_exhausted: 'انتهى وقت البحث المحدد',
};

export type LeadSearchMode = 'fast' | 'balanced' | 'deep';
