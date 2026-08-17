-- Lead Hunter core schema
-- Adds only new tables. Existing SocialPilot tables and migrations remain unchanged.

CREATE TABLE IF NOT EXISTS public.lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  connector_key text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('official_api','public_directory','professional_source','owned_source','lead_form')),
  enabled boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 100 CHECK (priority >= 0),
  rate_limit_per_minute integer CHECK (rate_limit_per_minute IS NULL OR rate_limit_per_minute > 0),
  status text NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured','healthy','degraded','disabled','error')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_health_at timestamptz,
  last_error text,
  records_found bigint NOT NULL DEFAULT 0 CHECK (records_found >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, connector_key)
);

CREATE TABLE IF NOT EXISTS public.lead_source_secrets (
  source_id uuid PRIMARY KEY REFERENCES public.lead_sources(id) ON DELETE CASCADE,
  encrypted_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- No policies: source credentials are service-role-only.
ALTER TABLE public.lead_source_secrets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_search_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  raw_query text NOT NULL CHECK (char_length(btrim(raw_query)) > 0),
  parsed_query jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_count integer NOT NULL DEFAULT 100 CHECK (requested_count > 0 AND requested_count <= 10000),
  objective text NOT NULL DEFAULT 'life_insurance_lead',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','queued','running','completed','failed','cancelled')),
  total_found integer NOT NULL DEFAULT 0 CHECK (total_found >= 0),
  valid_count integer NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  invalid_count integer NOT NULL DEFAULT 0 CHECK (invalid_count >= 0),
  qualified_count integer NOT NULL DEFAULT 0 CHECK (qualified_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_search_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  search_request_id uuid NOT NULL REFERENCES public.lead_search_requests(id) ON DELETE CASCADE,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (search_request_id)
);

CREATE TABLE IF NOT EXISTS public.lead_search_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  search_request_id uuid NOT NULL REFERENCES public.lead_search_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','paused','completed','failed','cancelled')),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  progress_stage text NOT NULL DEFAULT 'queued',
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries integer NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  last_error text,
  source_stats jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (search_request_id)
);

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  first_name text,
  last_name text,
  full_name text,
  age integer CHECK (age IS NULL OR age BETWEEN 0 AND 130),
  gender text,
  occupation text,
  job_title text,
  industry text,
  employer text,
  country text,
  governorate text,
  city text,
  district text,
  business_phone text,
  public_contact_phone text,
  business_email text,
  public_email text,
  professional_url text,
  social_url text,
  source_id uuid REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  source_url text,
  source_type text,
  collected_at timestamptz,
  last_verified_at timestamptz,
  data_quality_score numeric CHECK (data_quality_score IS NULL OR data_quality_score BETWEEN 0 AND 100),
  lead_score numeric CHECK (lead_score IS NULL OR lead_score BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','qualified','contacted','converted','suppressed','invalid','archived')),
  consent_status text NOT NULL DEFAULT 'unknown' CHECK (consent_status IN ('unknown','not_required','pending','consented','denied')),
  do_not_contact boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  contact_type text NOT NULL CHECK (contact_type IN ('business_phone','public_contact_phone','business_email','public_email')),
  value text NOT NULL,
  normalized_value text,
  is_verified boolean NOT NULL DEFAULT false,
  source_url text,
  collected_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, contact_type, normalized_value)
);

CREATE TABLE IF NOT EXISTS public.lead_source_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.lead_sources(id) ON DELETE CASCADE,
  external_id text,
  source_url text,
  raw_record jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  extraction_status text NOT NULL DEFAULT 'collected' CHECK (extraction_status IN ('collected','normalized','validated','rejected','failed')),
  validation_error text,
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS public.lead_search_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  search_request_id uuid NOT NULL REFERENCES public.lead_search_requests(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.lead_search_jobs(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  rank integer,
  inclusion_status text NOT NULL DEFAULT 'included' CHECK (inclusion_status IN ('included','excluded','suppressed','invalid')),
  deduplication_status text NOT NULL DEFAULT 'not_checked' CHECK (deduplication_status IN ('not_checked','confirmed_match','probable_match','possible_match','not_match')),
  data_quality_score numeric CHECK (data_quality_score IS NULL OR data_quality_score BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (search_request_id, lead_id)
);

CREATE TABLE IF NOT EXISTS public.lead_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  search_request_id uuid REFERENCES public.lead_search_requests(id) ON DELETE CASCADE,
  score numeric NOT NULL CHECK (score BETWEEN 0 AND 100),
  priority text NOT NULL CHECK (priority IN ('top','high','suitable','low','weak')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  scoring_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, search_request_id)
);

CREATE TABLE IF NOT EXISTS public.lead_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS public.lead_tag_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.lead_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, tag_id)
);

CREATE TABLE IF NOT EXISTS public.lead_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','archived')),
  search_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_campaign_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.lead_campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','contacted','qualified','converted','excluded')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_id)
);

CREATE TABLE IF NOT EXISTS public.lead_suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  normalized_key text NOT NULL,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, normalized_key)
);

CREATE TABLE IF NOT EXISTS public.lead_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  search_request_id uuid REFERENCES public.lead_search_requests(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.lead_campaigns(id) ON DELETE SET NULL,
  format text NOT NULL CHECK (format IN ('csv','xlsx','json')),
  selected_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  total_count integer NOT NULL DEFAULT 0,
  valid_count integer NOT NULL DEFAULT 0,
  suppressed_count integer NOT NULL DEFAULT 0,
  file_path text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.lead_ai_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  search_request_id uuid REFERENCES public.lead_search_requests(id) ON DELETE CASCADE,
  task text NOT NULL,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  explanation jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lead_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.lead_workspace_member(ws uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT public.user_workspace_role(ws) IS NOT NULL
$$;

CREATE INDEX IF NOT EXISTS idx_lead_sources_ws_priority ON public.lead_sources(workspace_id, enabled, priority);
CREATE INDEX IF NOT EXISTS idx_lead_requests_ws_created ON public.lead_search_requests(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_jobs_ws_status ON public.lead_search_jobs(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_ws_score ON public.leads(workspace_id, lead_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_leads_ws_location ON public.leads(workspace_id, governorate, city);
CREATE INDEX IF NOT EXISTS idx_leads_ws_status ON public.leads(workspace_id, status, do_not_contact);
CREATE INDEX IF NOT EXISTS idx_lead_contacts_ws_value ON public.lead_contacts(workspace_id, normalized_value);
CREATE INDEX IF NOT EXISTS idx_lead_records_ws_source ON public.lead_source_records(workspace_id, source_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_results_ws_search ON public.lead_search_results(workspace_id, search_request_id, rank);
CREATE INDEX IF NOT EXISTS idx_lead_scores_ws_score ON public.lead_scores(workspace_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_lead_campaigns_ws_created ON public.lead_campaigns(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_campaign_members_ws_campaign ON public.lead_campaign_members(workspace_id, campaign_id);
CREATE INDEX IF NOT EXISTS idx_lead_suppression_ws_key ON public.lead_suppression_list(workspace_id, normalized_key, active);
CREATE INDEX IF NOT EXISTS idx_lead_audit_ws_created ON public.lead_audit_logs(workspace_id, created_at DESC);

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'lead_sources','lead_search_requests','lead_search_filters','lead_search_jobs','leads',
    'lead_contacts','lead_source_records','lead_search_results','lead_scores','lead_tags',
    'lead_tag_links','lead_campaigns','lead_campaign_members','lead_suppression_list',
    'lead_exports','lead_ai_evaluations','lead_audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'lead_sources','lead_search_requests','lead_search_filters','lead_search_jobs','leads',
    'lead_contacts','lead_source_records','lead_search_results','lead_scores','lead_tags',
    'lead_tag_links','lead_campaigns','lead_campaign_members','lead_suppression_list',
    'lead_exports','lead_ai_evaluations','lead_audit_logs'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'lead_member_select_' || tbl, tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.lead_workspace_member(workspace_id))', 'lead_member_select_' || tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'lead_member_insert_' || tbl, tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.lead_workspace_member(workspace_id))', 'lead_member_insert_' || tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'lead_member_update_' || tbl, tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.lead_workspace_member(workspace_id)) WITH CHECK (public.lead_workspace_member(workspace_id))', 'lead_member_update_' || tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'lead_member_delete_' || tbl, tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.user_workspace_role(workspace_id) IN (''owner'',''admin''))', 'lead_member_delete_' || tbl, tbl);
  END LOOP;
END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'lead_sources','lead_search_requests','lead_search_jobs','leads','lead_campaigns','lead_source_secrets'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%I ON public.%I', tbl, tbl);
    EXECUTE format('CREATE TRIGGER trg_touch_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', tbl, tbl);
  END LOOP;
END $$;

COMMENT ON TABLE public.lead_sources IS 'Workspace-scoped, permissioned source connector configuration. Secrets stay server-side.';
COMMENT ON TABLE public.leads IS 'B2C individual leads only; unknown values remain NULL and are never inferred.';
COMMENT ON TABLE public.lead_search_jobs IS 'Background search lifecycle and failover/progress observability.';
