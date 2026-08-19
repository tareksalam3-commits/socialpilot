-- Autonomous AI Sales Researcher — additive schema only.
-- Keeps Lead Hunter as the single search system and preserves existing RLS patterns.

ALTER TABLE public.lead_hunter_settings
  ADD COLUMN IF NOT EXISTS searxng_base_url text,
  ADD COLUMN IF NOT EXISTS default_search_mode text NOT NULL DEFAULT 'balanced'
    CHECK (default_search_mode IN ('fast', 'balanced', 'deep')),
  ADD COLUMN IF NOT EXISTS max_queries integer NOT NULL DEFAULT 24 CHECK (max_queries > 0),
  ADD COLUMN IF NOT EXISTS max_fetches integer NOT NULL DEFAULT 40 CHECK (max_fetches >= 0),
  ADD COLUMN IF NOT EXISTS search_quota_daily integer NOT NULL DEFAULT 100 CHECK (search_quota_daily > 0),
  ADD COLUMN IF NOT EXISTS search_quota_monthly integer NOT NULL DEFAULT 2000 CHECK (search_quota_monthly > 0),
  ADD COLUMN IF NOT EXISTS searxng_last_health_at timestamptz,
  ADD COLUMN IF NOT EXISTS searxng_last_health_status text NOT NULL DEFAULT 'not_configured'
    CHECK (searxng_last_health_status IN ('healthy', 'degraded', 'error', 'not_configured')),
  ADD COLUMN IF NOT EXISTS searxng_last_health_error text;

ALTER TABLE public.lead_search_jobs
  ADD COLUMN IF NOT EXISTS search_memory jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS search_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.lead_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  search_request_id uuid REFERENCES public.lead_search_requests(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.lead_sources(id) ON DELETE SET NULL,
  source_url text,
  field text NOT NULL,
  evidence_text text NOT NULL,
  evidence_type text NOT NULL DEFAULT 'snippet'
    CHECK (evidence_type IN ('snippet', 'public_page', 'corroboration', 'verification')),
  verified boolean NOT NULL DEFAULT false,
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, source_url, field, evidence_text)
);
ALTER TABLE public.lead_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_member_select_lead_evidence ON public.lead_evidence;
CREATE POLICY lead_member_select_lead_evidence ON public.lead_evidence
  FOR SELECT TO authenticated USING (public.lead_workspace_member(workspace_id));
DROP POLICY IF EXISTS lead_member_insert_lead_evidence ON public.lead_evidence;
CREATE POLICY lead_member_insert_lead_evidence ON public.lead_evidence
  FOR INSERT TO authenticated WITH CHECK (public.lead_workspace_member(workspace_id));
DROP POLICY IF EXISTS lead_member_update_lead_evidence ON public.lead_evidence;
CREATE POLICY lead_member_update_lead_evidence ON public.lead_evidence
  FOR UPDATE TO authenticated USING (public.lead_workspace_member(workspace_id))
  WITH CHECK (public.lead_workspace_member(workspace_id));
DROP POLICY IF EXISTS lead_member_delete_lead_evidence ON public.lead_evidence;
CREATE POLICY lead_member_delete_lead_evidence ON public.lead_evidence
  FOR DELETE TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

ALTER TABLE public.lead_hunter_prompts DROP CONSTRAINT IF EXISTS lead_hunter_prompts_task_check;
ALTER TABLE public.lead_hunter_prompts ADD CONSTRAINT lead_hunter_prompts_task_check CHECK (
  task IN ('understand_lead_query','occupation_classification','lead_scoring','entity_resolution',
           'data_cleaning','ranking','score_explanation','research_agent_reasoning')
);

CREATE INDEX IF NOT EXISTS idx_lead_evidence_ws_lead ON public.lead_evidence(workspace_id, lead_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_evidence_source ON public.lead_evidence(source_id, collected_at DESC);

COMMENT ON COLUMN public.lead_hunter_settings.searxng_base_url IS 'Backend-only SearXNG HTTP endpoint; never returned with secrets to the frontend.';
COMMENT ON COLUMN public.lead_search_jobs.search_memory IS 'Auditable search memory: sources, strategies, seen/rejected/verified candidates, missing fields, strong/weak queries, and rounds.';
COMMENT ON COLUMN public.lead_search_jobs.search_summary IS 'Real final search summary shown to the user; derived from the job ledger, never fabricated.';
COMMENT ON TABLE public.lead_evidence IS 'Field-level public evidence supporting a Lead. Unknown values remain unknown; evidence is retained across sources.';
