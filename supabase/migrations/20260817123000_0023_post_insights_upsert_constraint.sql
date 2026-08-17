-- Make the post_insights conflict target inferable by PostgREST.
-- The earlier index is partial for non-null external IDs; this full unique
-- index is required by upsert(onConflict=...) and preserves the same key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_post_insight_snapshot_all
  ON public.post_insights(workspace_id, external_post_id, platform, metric, timestamp);
