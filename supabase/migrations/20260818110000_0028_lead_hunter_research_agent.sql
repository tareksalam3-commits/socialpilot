-- Lead Hunter AI Research Agent — additive schema only.
-- No existing table, column, policy, or trigger is altered/dropped.
-- Adds storage for the Understand -> Plan -> Query -> Loop pipeline so a
-- search request's structured specification and research plan are saved
-- and reusable (see §4, §15) instead of being recomputed and discarded.

ALTER TABLE public.lead_search_requests
  ADD COLUMN IF NOT EXISTS search_mode text NOT NULL DEFAULT 'balanced'
    CHECK (search_mode IN ('fast', 'balanced', 'deep')),
  ADD COLUMN IF NOT EXISTS hard_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS soft_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS research_plan jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.lead_search_jobs
  ADD COLUMN IF NOT EXISTS queries_used jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rounds_completed integer NOT NULL DEFAULT 0 CHECK (rounds_completed >= 0),
  ADD COLUMN IF NOT EXISTS stop_reason text;

-- Super Admin control over how many research rounds each Search Mode is
-- allowed to run, and a hard per-round candidate ceiling (§22, §33).
ALTER TABLE public.lead_hunter_settings
  ADD COLUMN IF NOT EXISTS max_rounds_fast integer NOT NULL DEFAULT 1 CHECK (max_rounds_fast > 0),
  ADD COLUMN IF NOT EXISTS max_rounds_balanced integer NOT NULL DEFAULT 3 CHECK (max_rounds_balanced > 0),
  ADD COLUMN IF NOT EXISTS max_rounds_deep integer NOT NULL DEFAULT 6 CHECK (max_rounds_deep > 0),
  ADD COLUMN IF NOT EXISTS max_candidates_per_round integer NOT NULL DEFAULT 200 CHECK (max_candidates_per_round > 0);

COMMENT ON COLUMN public.lead_search_requests.hard_requirements IS 'Requirements that reject a candidate outright if unmet (location/occupation-type criteria the user stated).';
COMMENT ON COLUMN public.lead_search_requests.soft_requirements IS 'Requirements that affect ranking/quality but do not by themselves disqualify a candidate.';
COMMENT ON COLUMN public.lead_search_requests.research_plan IS 'The AI research plan (what/where/queries/sources/stop-criteria) generated before searching started.';
COMMENT ON COLUMN public.lead_search_jobs.queries_used IS 'Every query string the research loop actually issued, in order, so a round never repeats one without reason (§15).';
COMMENT ON COLUMN public.lead_search_jobs.stop_reason IS 'Why the research loop stopped: target reached, quality plateau, sources exhausted, budget exhausted, or NOT_CONFIGURED.';
