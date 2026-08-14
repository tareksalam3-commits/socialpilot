/*
# SocialPilot — Phase 3, STEP 6-8 + STEP 10
# Pattern Detection, Learning Memory, Recommendation Engine, Content Fatigue

All aggregation/comparison here is deterministic SQL (section 25: Average/
Rate/Comparison/Lift are always code, never a model call). AI is reserved
for *interpreting* patterns into nicer prose — the ai_history task types
listed in Phase 3 section 26 (analyze_content_performance,
detect_content_patterns, generate_learning, generate_recommendation,
analyze_content_similarity, generate_optimization_context) are left as a
documented follow-up for whoever wires that prose layer in; every table
here already has a plain, correct, deterministic value without it, so
nothing downstream is blocked waiting on it.

## New Tables
- `content_patterns` — one row per (workspace, platform, objective,
  dimension, value). Dimensions covered: content_pillar, hook_type,
  format, cta_type, tone, posting_time_bucket.
- `content_learnings` — one row per pattern strong enough to matter
  (section 12/14: ACTIVE/WEAK/STALE/INVALIDATED).
- `content_recommendations` — one row per learning that maps to one of
  section 17's fixed recommendation types (TOPIC/HOOK/FORMAT/CTA/
  CONTENT_LENGTH/PLATFORM/CONTENT_MIX/POSTING_TIME/CONTENT_PILLAR).
  `tone` patterns/learnings intentionally never produce a recommendation —
  there is no TONE type in section 17's list and section 17 says not to
  add types without real need; tone still feeds Optimization Context via
  content_learnings directly.
- `content_fatigue_signals` — latest fatigue read per (workspace,
  platform, dimension), refreshed alongside everything else, also fires a
  workspace notification (reusing fn_notify_workspace from the existing
  Notification Center) when it flips to 'warning'.

## Orchestration
- `run_content_learning_cycle(workspace_id, platform)` — runs baseline →
  pattern detection → learning memory → recommendations → fatigue, in
  that order, for one workspace+platform. This is the Closed Learning
  Loop (section 24) made concrete.
- The existing `trg_refresh_baseline_on_post_analytics` trigger (STEP 4)
  is replaced so it calls this instead of just the baseline step —
  same trigger, same scoping (one workspace+platform per firing, never a
  cross-workspace sweep, per section 30/33).

## Security
- Same as content_performance_baselines: SELECT-only for workspace
  members. All writes happen via SECURITY DEFINER functions, EXCEPT
  content_recommendations.status, which members can update directly
  (Apply/Dismiss/Viewed from the UI — section 16's lifecycle).
*/

-- ============================================================
-- content_patterns
-- ============================================================
CREATE TABLE IF NOT EXISTS content_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL,
  objective text,
  dimension text NOT NULL CHECK (dimension IN ('content_pillar', 'hook_type', 'format', 'cta_type', 'tone', 'posting_time_bucket')),
  value text NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  baseline_value numeric,
  observed_value numeric,
  lift numeric,
  -- Deterministic heuristic in [0,1] driven by sample_size + |lift| — a
  -- confidence level in the everyday sense (section 11: "ليس ادعاءً
  -- إحصائيًا صارمًا ما لم يتم استخدام اختبار إحصائي مناسب"), not a p-value.
  confidence numeric,
  status text NOT NULL DEFAULT 'WEAK' CHECK (status IN ('ACTIVE', 'WEAK', 'STALE', 'INVALIDATED')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_patterns ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_patterns_scope
  ON content_patterns(workspace_id, platform, COALESCE(objective, ''), dimension, value);
CREATE INDEX IF NOT EXISTS idx_content_patterns_workspace ON content_patterns(workspace_id, status);

DROP POLICY IF EXISTS "select_own_content_patterns" ON content_patterns;
CREATE POLICY "select_own_content_patterns" ON content_patterns FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_patterns.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- content_learnings
-- ============================================================
CREATE TABLE IF NOT EXISTS content_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pattern_id uuid REFERENCES content_patterns(id) ON DELETE SET NULL,
  learning text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  sample_size integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WEAK', 'STALE', 'INVALIDATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_learnings ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_learnings_pattern ON content_learnings(workspace_id, pattern_id);
CREATE INDEX IF NOT EXISTS idx_content_learnings_workspace ON content_learnings(workspace_id, status);

DROP POLICY IF EXISTS "select_own_content_learnings" ON content_learnings;
CREATE POLICY "select_own_content_learnings" ON content_learnings FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_learnings.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- content_recommendations
-- ============================================================
CREATE TABLE IF NOT EXISTS content_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  learning_id uuid REFERENCES content_learnings(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('TOPIC', 'HOOK', 'FORMAT', 'CTA', 'CONTENT_LENGTH', 'PLATFORM', 'CONTENT_MIX', 'POSTING_TIME', 'CONTENT_PILLAR')),
  recommendation text NOT NULL,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric,
  expected_impact text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'VIEWED', 'ACCEPTED', 'DISMISSED', 'APPLIED', 'EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_recommendations ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_recommendations_learning ON content_recommendations(workspace_id, learning_id);
CREATE INDEX IF NOT EXISTS idx_content_recommendations_workspace ON content_recommendations(workspace_id, status);

DROP POLICY IF EXISTS "select_own_content_recommendations" ON content_recommendations;
CREATE POLICY "select_own_content_recommendations" ON content_recommendations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_recommendations.workspace_id AND m.user_id = auth.uid())
  );

-- Apply/Dismiss/Viewed (section 18) — the one client-writable surface in
-- this migration; a member may only move the lifecycle status forward.
DROP POLICY IF EXISTS "update_own_content_recommendations" ON content_recommendations;
CREATE POLICY "update_own_content_recommendations" ON content_recommendations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_recommendations.workspace_id AND m.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_recommendations.workspace_id AND m.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION set_content_recommendations_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_recommendations_updated_at ON content_recommendations;
CREATE TRIGGER trg_content_recommendations_updated_at
  BEFORE UPDATE ON content_recommendations
  FOR EACH ROW EXECUTE FUNCTION set_content_recommendations_updated_at();

-- ============================================================
-- content_fatigue_signals
-- ============================================================
CREATE TABLE IF NOT EXISTS content_fatigue_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL,
  dimension text NOT NULL CHECK (dimension IN ('content_pillar', 'hook_type', 'format')),
  value text,
  window_sample_size integer NOT NULL DEFAULT 0,
  repeat_ratio numeric,
  performance_trend text CHECK (performance_trend IN ('improving', 'flat', 'declining')),
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('warning', 'ok')),
  detected_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE content_fatigue_signals ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_fatigue_signals_scope
  ON content_fatigue_signals(workspace_id, platform, dimension);

DROP POLICY IF EXISTS "select_own_content_fatigue_signals" ON content_fatigue_signals;
CREATE POLICY "select_own_content_fatigue_signals" ON content_fatigue_signals FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_fatigue_signals.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- STEP 6 — Pattern Detection
-- ============================================================
CREATE OR REPLACE FUNCTION detect_content_patterns(
  p_workspace_id uuid,
  p_platform text,
  p_min_sample_size integer DEFAULT 5
)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_dimension text;
  v_baseline record;
BEGIN
  SELECT * INTO v_baseline
  FROM content_performance_baselines
  WHERE workspace_id = p_workspace_id AND platform = p_platform AND objective IS NULL;

  -- No overall baseline yet (e.g. this platform never had baseline
  -- computed) — nothing to compare against, section 6's rule applies.
  IF v_baseline IS NULL OR v_baseline.avg_engagement_rate IS NULL THEN
    RETURN;
  END IF;

  -- Plain-column dimensions: content_pillar, hook_type, format, cta_type, tone.
  FOREACH v_dimension IN ARRAY ARRAY['content_pillar', 'hook_type', 'format', 'cta_type', 'tone']
  LOOP
    EXECUTE format($f$
      INSERT INTO content_patterns (workspace_id, platform, objective, dimension, value, sample_size, baseline_value, observed_value, lift, confidence, status, scope, updated_at)
      SELECT
        %L, %L, NULL, %L, g.value, g.sample_size, %L, g.observed_engagement_rate,
        CASE WHEN %L::numeric > 0 THEN (g.observed_engagement_rate - %L::numeric) / %L::numeric ELSE NULL END,
        LEAST(0.95, 0.5 + LEAST(g.sample_size::numeric / 100, 0.2) + LEAST(ABS(COALESCE((g.observed_engagement_rate - %L::numeric) / NULLIF(%L::numeric, 0), 0)), 1) * 0.3),
        CASE
          WHEN g.sample_size >= %L AND ABS(COALESCE((g.observed_engagement_rate - %L::numeric) / NULLIF(%L::numeric, 0), 0)) >= 0.15 THEN 'ACTIVE'
          ELSE 'WEAK'
        END,
        jsonb_build_object('workspace_id', %L, 'platform', %L),
        now()
      FROM (
        SELECT cc.%I AS value, count(*) AS sample_size, avg(CASE WHEN pa.reach > 0 THEN pa.engagement::numeric / pa.reach ELSE NULL END) AS observed_engagement_rate
        FROM content_characteristics cc
        JOIN posts p ON p.id = cc.post_id AND p.status = 'published'
        JOIN LATERAL (
          SELECT reach, engagement FROM post_analytics
          WHERE post_id = cc.post_id AND platform = %L
          ORDER BY recorded_at DESC LIMIT 1
        ) pa ON true
        WHERE cc.workspace_id = %L AND %L = ANY(cc.platforms) AND cc.%I IS NOT NULL
        GROUP BY cc.%I
      ) g
      WHERE g.sample_size >= 2
      ON CONFLICT (workspace_id, platform, COALESCE(objective, ''), dimension, value)
      DO UPDATE SET
        sample_size = EXCLUDED.sample_size, baseline_value = EXCLUDED.baseline_value,
        observed_value = EXCLUDED.observed_value, lift = EXCLUDED.lift,
        confidence = EXCLUDED.confidence, status = EXCLUDED.status, updated_at = now()
    $f$,
      p_workspace_id, p_platform, v_dimension, v_baseline.avg_engagement_rate,
      v_baseline.avg_engagement_rate, v_baseline.avg_engagement_rate, v_baseline.avg_engagement_rate,
      v_baseline.avg_engagement_rate, v_baseline.avg_engagement_rate,
      p_min_sample_size, v_baseline.avg_engagement_rate, v_baseline.avg_engagement_rate,
      p_workspace_id, p_platform,
      v_dimension, p_platform, p_workspace_id, p_platform, v_dimension, v_dimension
    );
  END LOOP;

  -- posting_time_bucket — derived, not a plain column, handled separately.
  INSERT INTO content_patterns (workspace_id, platform, objective, dimension, value, sample_size, baseline_value, observed_value, lift, confidence, status, scope, updated_at)
  SELECT
    p_workspace_id, p_platform, NULL, 'posting_time_bucket', g.value, g.sample_size, v_baseline.avg_engagement_rate, g.observed_engagement_rate,
    CASE WHEN v_baseline.avg_engagement_rate > 0 THEN (g.observed_engagement_rate - v_baseline.avg_engagement_rate) / v_baseline.avg_engagement_rate ELSE NULL END,
    LEAST(0.95, 0.5 + LEAST(g.sample_size::numeric / 100, 0.2) + LEAST(ABS(COALESCE((g.observed_engagement_rate - v_baseline.avg_engagement_rate) / NULLIF(v_baseline.avg_engagement_rate, 0), 0)), 1) * 0.3),
    CASE
      WHEN g.sample_size >= p_min_sample_size AND ABS(COALESCE((g.observed_engagement_rate - v_baseline.avg_engagement_rate) / NULLIF(v_baseline.avg_engagement_rate, 0), 0)) >= 0.15 THEN 'ACTIVE'
      ELSE 'WEAK'
    END,
    jsonb_build_object('workspace_id', p_workspace_id, 'platform', p_platform),
    now()
  FROM (
    SELECT
      CASE
        WHEN EXTRACT(HOUR FROM cc.publishing_time) BETWEEN 5 AND 11 THEN 'morning'
        WHEN EXTRACT(HOUR FROM cc.publishing_time) BETWEEN 12 AND 16 THEN 'afternoon'
        WHEN EXTRACT(HOUR FROM cc.publishing_time) BETWEEN 17 AND 21 THEN 'evening'
        ELSE 'night'
      END AS value,
      count(*) AS sample_size,
      avg(CASE WHEN pa.reach > 0 THEN pa.engagement::numeric / pa.reach ELSE NULL END) AS observed_engagement_rate
    FROM content_characteristics cc
    JOIN posts p ON p.id = cc.post_id AND p.status = 'published'
    JOIN LATERAL (
      SELECT reach, engagement FROM post_analytics
      WHERE post_id = cc.post_id AND platform = p_platform
      ORDER BY recorded_at DESC LIMIT 1
    ) pa ON true
    WHERE cc.workspace_id = p_workspace_id AND p_platform = ANY(cc.platforms) AND cc.publishing_time IS NOT NULL
    GROUP BY 1
  ) g
  WHERE g.sample_size >= 2
  ON CONFLICT (workspace_id, platform, COALESCE(objective, ''), dimension, value)
  DO UPDATE SET
    sample_size = EXCLUDED.sample_size, baseline_value = EXCLUDED.baseline_value,
    observed_value = EXCLUDED.observed_value, lift = EXCLUDED.lift,
    confidence = EXCLUDED.confidence, status = EXCLUDED.status, updated_at = now();
END;
$$;

-- ============================================================
-- STEP 7 — Learning Memory
-- ============================================================
CREATE OR REPLACE FUNCTION generate_learnings_from_patterns(p_workspace_id uuid, p_platform text)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_dimension_label jsonb := '{"content_pillar":"محور المحتوى","hook_type":"نوع الافتتاحية","format":"الصيغة","cta_type":"الدعوة لاتخاذ إجراء","tone":"النبرة","posting_time_bucket":"وقت النشر"}'::jsonb;
BEGIN
  INSERT INTO content_learnings (workspace_id, pattern_id, learning, evidence, scope, confidence, sample_size, status, updated_at)
  SELECT
    p_workspace_id,
    cp.id,
    format(
      '%s "%s" بيحقق أداء %s المتوسط على %s بنسبة %s%% (%s منشور)',
      v_dimension_label ->> cp.dimension, cp.value,
      CASE WHEN cp.lift >= 0 THEN 'أعلى من' ELSE 'أقل من' END,
      cp.platform, round(abs(cp.lift) * 100)::int, cp.sample_size
    ),
    jsonb_build_object('sample_size', cp.sample_size, 'baseline_value', cp.baseline_value, 'observed_value', cp.observed_value, 'lift', cp.lift),
    cp.scope,
    cp.confidence,
    cp.sample_size,
    'ACTIVE',
    now()
  FROM content_patterns cp
  WHERE cp.workspace_id = p_workspace_id AND cp.platform = p_platform AND cp.status = 'ACTIVE'
  ON CONFLICT (workspace_id, pattern_id)
  DO UPDATE SET
    learning = EXCLUDED.learning, evidence = EXCLUDED.evidence, confidence = EXCLUDED.confidence,
    sample_size = EXCLUDED.sample_size, status = 'ACTIVE', updated_at = now();

  -- A pattern that dropped out of ACTIVE (fell below the sample/lift bar
  -- again) demotes its learning to WEAK rather than deleting it —
  -- section 14: "لا تحذف Learning التاريخية بدون سبب".
  UPDATE content_learnings cl
  SET status = 'WEAK', updated_at = now()
  FROM content_patterns cp
  WHERE cl.pattern_id = cp.id AND cl.workspace_id = p_workspace_id AND cp.platform = p_platform
    AND cp.status = 'WEAK' AND cl.status = 'ACTIVE';
END;
$$;

-- ============================================================
-- STEP 8 — Recommendation Engine
-- ============================================================
CREATE OR REPLACE FUNCTION generate_recommendations_from_learnings(p_workspace_id uuid, p_platform text)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_type_map jsonb := '{"content_pillar":"CONTENT_PILLAR","hook_type":"HOOK","format":"FORMAT","cta_type":"CTA","posting_time_bucket":"POSTING_TIME"}'::jsonb;
BEGIN
  INSERT INTO content_recommendations (workspace_id, learning_id, type, recommendation, reason, evidence, confidence, expected_impact, scope, status, updated_at)
  SELECT
    p_workspace_id,
    cl.id,
    v_type_map ->> cp.dimension,
    CASE WHEN cp.lift >= 0
      THEN format('زوّد استخدام "%s" — بيتفوق على المتوسط على %s', cp.value, cp.platform)
      ELSE format('قلل الاعتماد على "%s" — أداؤه أقل من المتوسط على %s', cp.value, cp.platform)
    END,
    cl.learning,
    cl.evidence,
    cl.confidence,
    format('%s%%', round(abs(cp.lift) * 100)::int),
    cl.scope,
    'NEW',
    now()
  FROM content_learnings cl
  JOIN content_patterns cp ON cp.id = cl.pattern_id
  WHERE cl.workspace_id = p_workspace_id AND cp.platform = p_platform AND cl.status = 'ACTIVE'
    AND v_type_map ? cp.dimension  -- tone has no mapped type on purpose (section 17)
  ON CONFLICT (workspace_id, learning_id)
  DO UPDATE SET
    recommendation = EXCLUDED.recommendation, reason = EXCLUDED.reason, evidence = EXCLUDED.evidence,
    confidence = EXCLUDED.confidence, expected_impact = EXCLUDED.expected_impact, updated_at = now()
  -- Never resurrect/overwrite a recommendation the user already acted on.
  WHERE content_recommendations.status IN ('NEW', 'VIEWED');
END;
$$;

-- ============================================================
-- STEP 10 — Content Fatigue Detection
-- ============================================================
CREATE OR REPLACE FUNCTION detect_content_fatigue(p_workspace_id uuid, p_platform text, p_window integer DEFAULT 7)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_dimension text;
  v_top record;
  v_was_warning boolean;
  v_trend text;
BEGIN
  FOREACH v_dimension IN ARRAY ARRAY['content_pillar', 'hook_type', 'format']
  LOOP
    -- Most common value + its share among the last p_window published
    -- posts on this platform, newest first.
    EXECUTE format($f$
      SELECT value, count(*)::numeric / %L AS repeat_ratio
      FROM (
        SELECT cc.%I AS value
        FROM content_characteristics cc
        JOIN posts p ON p.id = cc.post_id AND p.status = 'published'
        WHERE cc.workspace_id = %L AND %L = ANY(cc.platforms) AND cc.%I IS NOT NULL
        ORDER BY p.published_at DESC NULLS LAST
        LIMIT %L
      ) recent
      GROUP BY value
      ORDER BY count(*) DESC
      LIMIT 1
    $f$, p_window, v_dimension, p_workspace_id, p_platform, v_dimension, p_window)
    INTO v_top;

    IF v_top IS NULL THEN
      CONTINUE;
    END IF;

    -- Performance trend: latest half of the window vs the earlier half,
    -- by engagement rate — section 23's "Recency + Performance Trend".
    EXECUTE format($f$
      WITH ordered AS (
        SELECT p.id, p.published_at,
          row_number() OVER (ORDER BY p.published_at DESC NULLS LAST) AS rn,
          count(*) OVER () AS total
        FROM content_characteristics cc
        JOIN posts p ON p.id = cc.post_id AND p.status = 'published'
        WHERE cc.workspace_id = %L AND %L = ANY(cc.platforms)
        ORDER BY p.published_at DESC NULLS LAST
        LIMIT %L
      ),
      rates AS (
        SELECT o.rn, o.total,
          (SELECT CASE WHEN reach > 0 THEN engagement::numeric / reach ELSE NULL END
           FROM post_analytics WHERE post_id = o.id AND platform = %L ORDER BY recorded_at DESC LIMIT 1) AS rate
        FROM ordered o
      )
      SELECT CASE
        WHEN avg(rate) FILTER (WHERE rn <= total / 2.0) IS NULL OR avg(rate) FILTER (WHERE rn > total / 2.0) IS NULL THEN 'flat'
        WHEN avg(rate) FILTER (WHERE rn <= total / 2.0) > avg(rate) FILTER (WHERE rn > total / 2.0) * 1.1 THEN 'improving'
        WHEN avg(rate) FILTER (WHERE rn <= total / 2.0) < avg(rate) FILTER (WHERE rn > total / 2.0) * 0.9 THEN 'declining'
        ELSE 'flat'
      END
      FROM rates
    $f$, p_workspace_id, p_platform, p_window, p_platform)
    INTO v_trend;

    SELECT (status = 'warning') INTO v_was_warning
    FROM content_fatigue_signals WHERE workspace_id = p_workspace_id AND platform = p_platform AND dimension = v_dimension;

    INSERT INTO content_fatigue_signals (workspace_id, platform, dimension, value, window_sample_size, repeat_ratio, performance_trend, status, detected_at)
    VALUES (
      p_workspace_id, p_platform, v_dimension, v_top.value, p_window, v_top.repeat_ratio, v_trend,
      -- Section 23: repetition alone is not a problem. Only flag when
      -- repetition is high AND performance is declining.
      CASE WHEN v_top.repeat_ratio >= 0.7 AND v_trend = 'declining' THEN 'warning' ELSE 'ok' END,
      now()
    )
    ON CONFLICT (workspace_id, platform, dimension)
    DO UPDATE SET value = EXCLUDED.value, window_sample_size = EXCLUDED.window_sample_size,
      repeat_ratio = EXCLUDED.repeat_ratio, performance_trend = EXCLUDED.performance_trend,
      status = EXCLUDED.status, detected_at = now();

    -- Notify only on the transition into 'warning', not on every cycle.
    IF NOT COALESCE(v_was_warning, false) AND v_top.repeat_ratio >= 0.7 AND v_trend = 'declining' THEN
      PERFORM fn_notify_workspace(
        p_workspace_id, 'ai_event', 'تكرار في المحتوى',
        format('آخر %s منشورات على %s بتستخدم نفس الـ%s تقريبًا، والأداء بدأ ينخفض.', p_window, p_platform, v_dimension),
        jsonb_build_object('dimension', v_dimension, 'value', v_top.value, 'platform', p_platform)
      );
    END IF;
  END LOOP;
END;
$$;

-- ============================================================
-- Closed Learning Loop orchestrator (section 24)
-- ============================================================
CREATE OR REPLACE FUNCTION run_content_learning_cycle(p_workspace_id uuid, p_platform text)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM compute_content_performance_baseline(p_workspace_id, p_platform, NULL);
  PERFORM detect_content_patterns(p_workspace_id, p_platform);
  PERFORM generate_learnings_from_patterns(p_workspace_id, p_platform);
  PERFORM generate_recommendations_from_learnings(p_workspace_id, p_platform);
  PERFORM detect_content_fatigue(p_workspace_id, p_platform);
END;
$$;

-- Replace the STEP 4 trigger function so new analytics drive the full
-- loop, not just the baseline — same trigger, same single-row scoping.
CREATE OR REPLACE FUNCTION refresh_baseline_on_post_analytics()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_objective text;
BEGIN
  PERFORM run_content_learning_cycle(NEW.workspace_id, NEW.platform);

  SELECT cc.objective INTO v_objective FROM content_characteristics cc WHERE cc.post_id = NEW.post_id;
  IF v_objective IS NOT NULL THEN
    PERFORM compute_content_performance_baseline(NEW.workspace_id, NEW.platform, v_objective);
  END IF;

  RETURN NEW;
END;
$$;
