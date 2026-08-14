/*
# SocialPilot — Phase 3, STEP 2 + STEP 5
# Content Learning & Optimization: Performance Data + Content <-> Performance

## Audit outcome this migration acts on
- `post_analytics` (from 20260731214334) already covers reach/impressions/
  engagement/clicks/likes/comments/shares per post per platform, RLS'd and
  workspace-scoped. REUSED AS-IS, extended (not replaced) with the
  platform metrics Phase 3 section 3 needs that weren't tracked yet: saves,
  views, watch_time_seconds, completion_rate, profile_visits. Nullable,
  since section 3 explicitly forbids assuming a metric exists on every
  platform.
- `account_analytics` REUSED AS-IS — no changes needed for this step.
- No duplicate-analytics guard existed (section 29). Added a generated
  `analytics_date` + unique constraint so re-syncing the same
  post/platform/day updates instead of duplicating rows.
- No structured, queryable content characteristics existed anywhere.
  `posts.metadata->assistant` only carries quality/source_request/
  platform_variants/ai_decision (src/features/assistant/
  useAssistantPipeline.ts) — never topic/pillar/hook/format/cta/tone/
  objective. `ContentStrategy` (src/types/context.ts) and `HookCandidate`
  carry exactly those fields at generation time but are never persisted
  past the run. This is the gap section 5 ("Content <-> Performance") is
  about. NEW TABLE: `content_characteristics`, one row per post, written
  once at creation time by the app layer (wiring is the next concrete
  step — this migration only adds the place for it to land).
- Manually-created / imported posts (not run through the Assistant
  pipeline) will simply have no `content_characteristics` row — patterns
  and learnings can only be computed over posts that do, which is
  correct per section 10 (Minimum Evidence): no data, no inference.

## New Tables
- `content_characteristics` — structured, queryable content properties
  per post (topic, content_pillar, hook_type, format, length_bucket,
  cta_type, tone, objective, audience_persona), FK'd 1:1 to posts.

## Modified Tables
- `post_analytics` — add saves, views, watch_time_seconds,
  completion_rate, profile_visits, raw_metrics (jsonb, platform-native
  values kept verbatim per section 4's "لا تفقد Platform-specific
  metrics"). Add analytics_date + unique (post_id, platform,
  analytics_date) to stop duplicate syncs from stacking rows.

## Security
- RLS on content_characteristics: same workspace_members shape as
  `posts` (any member can read/write, since it is authored alongside a
  post they're already allowed to create/edit) — NOT the owner-only
  shape used by audience_profiles/brand_voice, because this is
  per-post data, not a single workspace-wide profile.
*/

-- ============================================================
-- post_analytics: extend with the missing platform metrics
-- ============================================================
ALTER TABLE post_analytics
  ADD COLUMN IF NOT EXISTS saves integer,
  ADD COLUMN IF NOT EXISTS views integer,
  ADD COLUMN IF NOT EXISTS watch_time_seconds numeric,
  ADD COLUMN IF NOT EXISTS completion_rate numeric,
  ADD COLUMN IF NOT EXISTS profile_visits integer,
  ADD COLUMN IF NOT EXISTS raw_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS analytics_date date GENERATED ALWAYS AS ((recorded_at AT TIME ZONE 'UTC')::date) STORED;

-- Section 29: stop duplicate ingestion. One row per post/platform/day —
-- a re-sync on the same day updates via ON CONFLICT rather than stacking.
CREATE UNIQUE INDEX IF NOT EXISTS uq_post_analytics_post_platform_day
  ON post_analytics(post_id, platform, analytics_date);

-- ============================================================
-- content_characteristics
-- ============================================================
CREATE TABLE IF NOT EXISTS content_characteristics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  topic text,
  content_pillar text,
  hook_type text,
  hook_text text,
  format text,
  length_bucket text CHECK (length_bucket IS NULL OR length_bucket IN ('short', 'medium', 'long')),
  char_count integer,
  cta_type text,
  tone text,
  objective text,
  audience_persona text,
  platforms text[] NOT NULL DEFAULT '{}',
  publishing_time timestamptz,
  -- Verbatim ContentStrategy/HookAgentResult snapshot this row was derived
  -- from, kept for traceability the same way ai_history.metadata works —
  -- never read by the Learning Engine directly, only by humans debugging.
  source jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_characteristics ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_content_characteristics_workspace_id ON content_characteristics(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_characteristics_pillar ON content_characteristics(workspace_id, content_pillar);
CREATE INDEX IF NOT EXISTS idx_content_characteristics_hook_type ON content_characteristics(workspace_id, hook_type);
CREATE INDEX IF NOT EXISTS idx_content_characteristics_objective ON content_characteristics(workspace_id, objective);

DROP POLICY IF EXISTS "select_own_content_characteristics" ON content_characteristics;
CREATE POLICY "select_own_content_characteristics" ON content_characteristics FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_characteristics.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_content_characteristics" ON content_characteristics;
CREATE POLICY "insert_own_content_characteristics" ON content_characteristics FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_characteristics.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_content_characteristics" ON content_characteristics;
CREATE POLICY "update_own_content_characteristics" ON content_characteristics FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_characteristics.workspace_id AND m.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_characteristics.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_content_characteristics" ON content_characteristics;
CREATE POLICY "delete_own_content_characteristics" ON content_characteristics FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_characteristics.workspace_id AND m.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION set_content_characteristics_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_characteristics_updated_at ON content_characteristics;
CREATE TRIGGER trg_content_characteristics_updated_at
  BEFORE UPDATE ON content_characteristics
  FOR EACH ROW EXECUTE FUNCTION set_content_characteristics_updated_at();
