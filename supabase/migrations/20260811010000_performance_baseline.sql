/*
# SocialPilot — Phase 3, STEP 4
# Content Learning & Optimization: Performance Baseline

## Audit note (blocking dependency, not created by this migration)
`post_analytics` rows are currently only ever seeded as zeros at publish
time (supabase/functions/_shared/orchestrator.ts::seedPostAnalytics) —
there is no sync job anywhere that ever updates them with real platform
numbers. This migration's baseline logic is written to be correct
regardless: with only zero-rows it will simply report
`min_sample_size_met = false` / `insufficient_data`, per section 6 ("لا
تعتبر المقارنة صحيحة إذا كانت البيانات غير كافية"). It starts producing
real baselines automatically the moment real analytics ingestion exists —
no change needed here when that lands.

## New Tables
- `content_performance_baselines` — one row per (workspace_id, platform,
  objective), objective nullable meaning "all objectives" (section 6's
  plain baseline). Objective-specific rows additionally support section 7
  (Objective-aware Performance).

## New Functions
- `compute_content_performance_baseline(workspace_id, platform, objective,
  min_sample_size)` — deterministic (no AI, per section 25: Average/Rate/
  Aggregation/Baseline are always code, never model calls). Uses each
  post's MOST RECENT analytics snapshot (not summed across days — reach/
  engagement are cumulative-to-date per platform, so latest = current
  truth for that post) among posts with `status = 'published'`.
- Trigger on `post_analytics` refreshes only the affected
  (workspace_id, platform) baseline plus any objective-specific baseline
  for objectives seen in that workspace/platform's `content_characteristics`
  — never a full-history recompute of every workspace (section 30/33).

## Security
- RLS: workspace members can read; writes only via SECURITY DEFINER
  compute function (service-role/trigger context), never directly from
  the client — baselines are a derived, computed artifact, not
  user-authored data.
*/

CREATE TABLE IF NOT EXISTS content_performance_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL,
  -- NULL = baseline across all objectives for this workspace+platform.
  objective text,
  sample_size integer NOT NULL DEFAULT 0,
  min_sample_size_met boolean NOT NULL DEFAULT false,
  avg_reach numeric,
  avg_impressions numeric,
  avg_engagement numeric,
  avg_engagement_rate numeric,
  avg_likes numeric,
  avg_comments numeric,
  avg_shares numeric,
  avg_saves numeric,
  avg_clicks numeric,
  avg_ctr numeric,
  avg_views numeric,
  avg_watch_time_seconds numeric,
  avg_completion_rate numeric,
  avg_profile_visits numeric,
  computed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_performance_baselines ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_performance_baselines_scope
  ON content_performance_baselines(workspace_id, platform, COALESCE(objective, ''));

CREATE INDEX IF NOT EXISTS idx_content_performance_baselines_workspace
  ON content_performance_baselines(workspace_id, platform);

DROP POLICY IF EXISTS "select_own_content_performance_baselines" ON content_performance_baselines;
CREATE POLICY "select_own_content_performance_baselines" ON content_performance_baselines FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_performance_baselines.workspace_id AND m.user_id = auth.uid())
  );
-- No client-side INSERT/UPDATE/DELETE policies on purpose — only the
-- SECURITY DEFINER function below (running as the row-level trigger owner)
-- writes to this table.

-- ============================================================
-- compute_content_performance_baseline
-- ============================================================
CREATE OR REPLACE FUNCTION compute_content_performance_baseline(
  p_workspace_id uuid,
  p_platform text,
  p_objective text DEFAULT NULL,
  p_min_sample_size integer DEFAULT 5
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_sample_size integer;
BEGIN
  -- Most recent analytics snapshot per published post on this platform,
  -- optionally restricted to a single objective via content_characteristics.
  WITH latest_analytics AS (
    SELECT DISTINCT ON (pa.post_id)
      pa.post_id, pa.reach, pa.impressions, pa.engagement, pa.clicks,
      pa.likes, pa.comments, pa.shares, pa.saves, pa.views,
      pa.watch_time_seconds, pa.completion_rate, pa.profile_visits
    FROM post_analytics pa
    JOIN posts p ON p.id = pa.post_id
    WHERE pa.workspace_id = p_workspace_id
      AND pa.platform = p_platform
      AND p.status = 'published'
      AND (
        p_objective IS NULL
        OR EXISTS (
          SELECT 1 FROM content_characteristics cc
          WHERE cc.post_id = pa.post_id AND cc.objective = p_objective
        )
      )
    ORDER BY pa.post_id, pa.recorded_at DESC
  )
  SELECT count(*) INTO v_sample_size FROM latest_analytics;

  INSERT INTO content_performance_baselines (
    workspace_id, platform, objective, sample_size, min_sample_size_met,
    avg_reach, avg_impressions, avg_engagement, avg_engagement_rate,
    avg_likes, avg_comments, avg_shares, avg_saves, avg_clicks, avg_ctr,
    avg_views, avg_watch_time_seconds, avg_completion_rate, avg_profile_visits,
    computed_at
  )
  SELECT
    p_workspace_id, p_platform, p_objective, v_sample_size, v_sample_size >= p_min_sample_size,
    avg(reach), avg(impressions), avg(engagement),
    avg(CASE WHEN reach > 0 THEN engagement::numeric / reach ELSE NULL END),
    avg(likes), avg(comments), avg(shares), avg(saves),
    avg(clicks), avg(CASE WHEN impressions > 0 THEN clicks::numeric / impressions ELSE NULL END),
    avg(views), avg(watch_time_seconds), avg(completion_rate), avg(profile_visits),
    now()
  FROM (
    SELECT
      pa.post_id, pa.reach, pa.impressions, pa.engagement, pa.clicks,
      pa.likes, pa.comments, pa.shares, pa.saves, pa.views,
      pa.watch_time_seconds, pa.completion_rate, pa.profile_visits
    FROM post_analytics pa
    JOIN posts p ON p.id = pa.post_id
    WHERE pa.workspace_id = p_workspace_id
      AND pa.platform = p_platform
      AND p.status = 'published'
      AND (
        p_objective IS NULL
        OR EXISTS (
          SELECT 1 FROM content_characteristics cc
          WHERE cc.post_id = pa.post_id AND cc.objective = p_objective
        )
      )
      AND pa.id IN (
        SELECT DISTINCT ON (post_id) id FROM post_analytics
        WHERE workspace_id = p_workspace_id AND platform = p_platform
        ORDER BY post_id, recorded_at DESC
      )
  ) latest
  ON CONFLICT (workspace_id, platform, COALESCE(objective, ''))
  DO UPDATE SET
    sample_size = EXCLUDED.sample_size,
    min_sample_size_met = EXCLUDED.min_sample_size_met,
    avg_reach = EXCLUDED.avg_reach,
    avg_impressions = EXCLUDED.avg_impressions,
    avg_engagement = EXCLUDED.avg_engagement,
    avg_engagement_rate = EXCLUDED.avg_engagement_rate,
    avg_likes = EXCLUDED.avg_likes,
    avg_comments = EXCLUDED.avg_comments,
    avg_shares = EXCLUDED.avg_shares,
    avg_saves = EXCLUDED.avg_saves,
    avg_clicks = EXCLUDED.avg_clicks,
    avg_ctr = EXCLUDED.avg_ctr,
    avg_views = EXCLUDED.avg_views,
    avg_watch_time_seconds = EXCLUDED.avg_watch_time_seconds,
    avg_completion_rate = EXCLUDED.avg_completion_rate,
    avg_profile_visits = EXCLUDED.avg_profile_visits,
    computed_at = EXCLUDED.computed_at;

  -- Zero-sample case: the SELECT above still needs a row inserted so
  -- min_sample_size_met = false is discoverable, even if latest_analytics
  -- was empty and the aggregate SELECT produced no group.
  IF v_sample_size = 0 THEN
    INSERT INTO content_performance_baselines (workspace_id, platform, objective, sample_size, min_sample_size_met, computed_at)
    VALUES (p_workspace_id, p_platform, p_objective, 0, false, now())
    ON CONFLICT (workspace_id, platform, COALESCE(objective, ''))
    DO UPDATE SET sample_size = 0, min_sample_size_met = false, computed_at = now();
  END IF;
END;
$$;

-- ============================================================
-- Refresh trigger — scoped, not a full recompute (section 30/33)
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_baseline_on_post_analytics()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_objective text;
BEGIN
  -- Overall (all-objectives) baseline for this workspace+platform.
  PERFORM compute_content_performance_baseline(NEW.workspace_id, NEW.platform, NULL);

  -- Plus the specific objective this post was tagged with, if any —
  -- keeps section 7's objective-aware baselines current without
  -- recomputing every objective in the workspace on every analytics row.
  SELECT cc.objective INTO v_objective
  FROM content_characteristics cc
  WHERE cc.post_id = NEW.post_id;

  IF v_objective IS NOT NULL THEN
    PERFORM compute_content_performance_baseline(NEW.workspace_id, NEW.platform, v_objective);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_baseline_on_post_analytics ON post_analytics;
CREATE TRIGGER trg_refresh_baseline_on_post_analytics
  AFTER INSERT OR UPDATE ON post_analytics
  FOR EACH ROW EXECUTE FUNCTION refresh_baseline_on_post_analytics();
