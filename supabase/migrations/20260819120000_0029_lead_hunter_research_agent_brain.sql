-- Lead Hunter — AI Research Agent "brain" support (additive only).
-- Adds a per-round AI reasoning trail so the researcher's plan/adapt/stop
-- decisions are auditable and feed the next round's prompt (§14, §15, §27).
-- No existing column, table, policy, or behavior is removed or altered.

ALTER TABLE public.lead_search_jobs
  ADD COLUMN IF NOT EXISTS strategy_notes jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.lead_search_jobs.strategy_notes IS
  'Per-round AI reasoning trail: queries chosen, why, quality signal, and the round_review decision (continue/stop). Written by the research loop, read by the UI to show real (non-fake) progress narration.';
