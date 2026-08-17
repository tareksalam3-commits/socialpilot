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
  created_at: string;
  updated_at: string;
};

export type LeadSearchStats = {
  totalFound: number;
  valid: number;
  duplicates: number;
  invalid: number;
  qualified: number;
};

export const LEAD_JOB_STAGE_LABELS: Record<string, string> = {
  queued: 'في الانتظار',
  analyzing: 'تحليل الطلب',
  selecting_sources: 'اختيار المصادر',
  searching: 'البحث عن العملاء',
  collecting: 'جمع البيانات',
  cleaning: 'تنظيف البيانات',
  deduplicating: 'إزالة التكرارات',
  qualifying: 'تحليل العملاء',
  scoring: 'حساب درجات العملاء',
  completed: 'اكتمل',
  failed: 'فشل',
};
