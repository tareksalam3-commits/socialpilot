-- Lead Hunter Super Admin control plane.
-- All platform-level configuration is isolated from existing SocialPilot tables.

CREATE TABLE IF NOT EXISTS public.lead_hunter_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  lead_hunter_enabled boolean NOT NULL DEFAULT true,
  lead_search_enabled boolean NOT NULL DEFAULT true,
  lead_ai_enabled boolean NOT NULL DEFAULT true,
  lead_scoring_enabled boolean NOT NULL DEFAULT true,
  lead_export_enabled boolean NOT NULL DEFAULT true,
  lead_campaigns_enabled boolean NOT NULL DEFAULT true,
  lead_social_sources_enabled boolean NOT NULL DEFAULT false,
  kill_switch boolean NOT NULL DEFAULT false,
  default_lead_score numeric NOT NULL DEFAULT 60 CHECK (default_lead_score BETWEEN 0 AND 100),
  default_search_limit integer NOT NULL DEFAULT 100 CHECK (default_search_limit > 0),
  min_search_limit integer NOT NULL DEFAULT 1 CHECK (min_search_limit > 0),
  max_search_limit integer NOT NULL DEFAULT 10000 CHECK (max_search_limit >= min_search_limit),
  max_runtime_seconds integer NOT NULL DEFAULT 900 CHECK (max_runtime_seconds > 0),
  max_sources integer NOT NULL DEFAULT 10 CHECK (max_sources > 0),
  smart_over_collection boolean NOT NULL DEFAULT true,
  deduplication_enabled boolean NOT NULL DEFAULT true,
  validation_enabled boolean NOT NULL DEFAULT true,
  ai_scoring_enabled boolean NOT NULL DEFAULT true,
  freshness_days integer NOT NULL DEFAULT 90 CHECK (freshness_days > 0),
  data_quality_threshold numeric NOT NULL DEFAULT 60 CHECK (data_quality_threshold BETWEEN 0 AND 100),
  default_retry integer NOT NULL DEFAULT 3 CHECK (default_retry >= 0),
  default_timeout_seconds integer NOT NULL DEFAULT 30 CHECK (default_timeout_seconds > 0),
  default_ai_model text,
  default_export_format text NOT NULL DEFAULT 'csv' CHECK (default_export_format IN ('csv','xlsx','json')),
  default_retention_days integer NOT NULL DEFAULT 90 CHECK (default_retention_days > 0),
  global_suppression boolean NOT NULL DEFAULT false,
  automatic_source_disable boolean NOT NULL DEFAULT false,
  error_rate_threshold numeric NOT NULL DEFAULT 50 CHECK (error_rate_threshold BETWEEN 0 AND 100),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_hunter_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_hunter_scoring_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  lead_score_weights jsonb NOT NULL DEFAULT '{"location":20,"age":15,"occupation":20,"contact":20,"freshness":10,"source_quality":10,"search_match":5}'::jsonb,
  lead_score_thresholds jsonb NOT NULL DEFAULT '{"top":90,"high":75,"suitable":60,"low":40}'::jsonb,
  quality_weights jsonb NOT NULL DEFAULT '{"name":20,"location":15,"occupation":15,"phone":20,"email":10,"source":10,"freshness":10}'::jsonb,
  validation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  freshness_thresholds jsonb NOT NULL DEFAULT '{"fresh":30,"verified":90,"stale":365}'::jsonb,
  deduplication_rules jsonb NOT NULL DEFAULT '{"phone":true,"email":true,"profile":true,"fuzzy_name":true,"location":true,"confidence_threshold":0.95}'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_hunter_scoring_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_hunter_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task text NOT NULL CHECK (task IN ('understand_lead_query','occupation_classification','lead_scoring','entity_resolution','data_cleaning','ranking','score_explanation')),
  version integer NOT NULL CHECK (version > 0),
  prompt text NOT NULL CHECK (char_length(btrim(prompt)) > 0),
  model text,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task, version)
);
ALTER TABLE public.lead_hunter_prompts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_hunter_workspace_limits (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  daily_searches integer CHECK (daily_searches IS NULL OR daily_searches >= 0),
  monthly_searches integer CHECK (monthly_searches IS NULL OR monthly_searches >= 0),
  max_leads_per_search integer CHECK (max_leads_per_search IS NULL OR max_leads_per_search > 0),
  daily_leads integer CHECK (daily_leads IS NULL OR daily_leads >= 0),
  monthly_leads integer CHECK (monthly_leads IS NULL OR monthly_leads >= 0),
  daily_exports integer CHECK (daily_exports IS NULL OR daily_exports >= 0),
  monthly_exports integer CHECK (monthly_exports IS NULL OR monthly_exports >= 0),
  ai_usage numeric CHECK (ai_usage IS NULL OR ai_usage >= 0),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_hunter_workspace_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_hunter_permissions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('lead_hunter.view','lead_hunter.search','lead_hunter.export','lead_hunter.campaigns','lead_hunter.manage_sources','lead_hunter.manage_ai','lead_hunter.admin')),
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);
ALTER TABLE public.lead_hunter_permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_hunter_source_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.lead_sources(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.lead_search_jobs(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('running','success','warning','error','not_configured')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  records_found integer NOT NULL DEFAULT 0 CHECK (records_found >= 0),
  success boolean NOT NULL DEFAULT false,
  error_rate numeric CHECK (error_rate IS NULL OR error_rate BETWEEN 0 AND 100),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_hunter_source_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_hunter_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.lead_search_jobs(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  error_type text NOT NULL,
  severity text NOT NULL DEFAULT 'error' CHECK (severity IN ('info','warning','error','critical')),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','ignored','resolved')),
  occurrence_count integer NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_occurred_at timestamptz NOT NULL DEFAULT now(),
  last_occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_hunter_errors ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_hunter_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('search','lead_collected','ai_request','export','job','storage')),
  units numeric NOT NULL DEFAULT 1 CHECK (units >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_hunter_usage_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.lead_hunter_admin_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource text NOT NULL,
  resource_id uuid,
  old_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
  ip_address inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lead_hunter_admin_logs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.lead_hunter_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.lead_hunter_scoring_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_lead_hunter_source_runs_source ON public.lead_hunter_source_runs(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_hunter_source_runs_status ON public.lead_hunter_source_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_hunter_errors_status ON public.lead_hunter_errors(status, severity, last_occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_hunter_usage_workspace ON public.lead_hunter_usage_events(workspace_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_hunter_admin_logs_created ON public.lead_hunter_admin_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_hunter_permissions_user ON public.lead_hunter_permissions(user_id);

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['lead_hunter_settings','lead_hunter_scoring_settings','lead_hunter_prompts','lead_hunter_workspace_limits','lead_hunter_permissions','lead_hunter_source_runs','lead_hunter_errors','lead_hunter_usage_events','lead_hunter_admin_logs'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'lh_admin_all_' || tbl, tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())', 'lh_admin_all_' || tbl, tbl);
  END LOOP;
END $$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['lead_hunter_settings','lead_hunter_scoring_settings','lead_hunter_workspace_limits'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%I ON public.%I', tbl, tbl);
    EXECUTE format('CREATE TRIGGER trg_touch_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()', tbl, tbl);
  END LOOP;
END $$;

COMMENT ON TABLE public.lead_hunter_settings IS 'Global Lead Hunter controls, feature flags, kill switch, quotas defaults, and retention settings.';
COMMENT ON TABLE public.lead_hunter_prompts IS 'Versioned Lead Hunter prompts; old versions remain available for rollback/history.';
COMMENT ON TABLE public.lead_hunter_admin_logs IS 'Super Admin audit trail. Secret values must never be written here.';
