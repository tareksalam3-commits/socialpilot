/*
# SocialPilot — Phase 3, STEP 12
# Security + RLS Validation

## Finding
`compute_content_performance_baseline`, `detect_content_patterns`,
`generate_learnings_from_patterns`, `generate_recommendations_from_learnings`,
`detect_content_fatigue`, and `run_content_learning_cycle` are all
SECURITY DEFINER, which bypasses RLS entirely, and none of them checked
who was calling. Supabase exposes every `public` schema function as an
RPC endpoint by default — any authenticated user could have called
`run_content_learning_cycle('<someone-else-workspace-id>', 'linkedin')`
directly and forced recomputation for a workspace they aren't a member
of, or worse, triggered `detect_content_fatigue`'s
`fn_notify_workspace()` call and spammed that workspace's members with a
notification. Both are workspace-isolation violations (section 34).

The existing codebase's own convention for this exact situation
(get_ai_provider_key, 20260731213212) is an internal identity check
inside the function body rather than a REVOKE — followed here for
consistency: every function below now no-ops (RETURN/RETURN void) when
`auth.uid()` resolves to a real user who is *not* a member of
`p_workspace_id`. When `auth.uid()` is NULL — the trigger's normal
calling context when analytics are written by the service role/edge
functions — the check is skipped, since there is no end-user identity to
validate and the trigger's own scoping (one workspace+platform per
analytics row) is already correct.

No table or RLS policy changes needed here — STEP 4/6/7/8/10 policies
were already SELECT-only for members (plus one status-only UPDATE policy
on content_recommendations), which was correct. This migration only
closes the function-level gap.
*/

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
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = auth.uid()) THEN
    RETURN;
  END IF;

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
  ON CONFLICT (workspace_id, platform, (COALESCE(objective, '')))
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

  IF v_sample_size = 0 THEN
    INSERT INTO content_performance_baselines (workspace_id, platform, objective, sample_size, min_sample_size_met, computed_at)
    VALUES (p_workspace_id, p_platform, p_objective, 0, false, now())
    ON CONFLICT (workspace_id, platform, (COALESCE(objective, '')))
    DO UPDATE SET sample_size = 0, min_sample_size_met = false, computed_at = now();
  END IF;
END;
$$;

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
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = auth.uid()) THEN
    RETURN;
  END IF;

  SELECT * INTO v_baseline
  FROM content_performance_baselines
  WHERE workspace_id = p_workspace_id AND platform = p_platform AND objective IS NULL;

  IF v_baseline IS NULL OR v_baseline.avg_engagement_rate IS NULL THEN
    RETURN;
  END IF;

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
      ON CONFLICT (workspace_id, platform, (COALESCE(objective, '')), dimension, value)
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
  ON CONFLICT (workspace_id, platform, (COALESCE(objective, '')), dimension, value)
  DO UPDATE SET
    sample_size = EXCLUDED.sample_size, baseline_value = EXCLUDED.baseline_value,
    observed_value = EXCLUDED.observed_value, lift = EXCLUDED.lift,
    confidence = EXCLUDED.confidence, status = EXCLUDED.status, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION generate_learnings_from_patterns(p_workspace_id uuid, p_platform text)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_dimension_label jsonb := '{"content_pillar":"محور المحتوى","hook_type":"نوع الافتتاحية","format":"الصيغة","cta_type":"الدعوة لاتخاذ إجراء","tone":"النبرة","posting_time_bucket":"وقت النشر"}'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = auth.uid()) THEN
    RETURN;
  END IF;

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

  UPDATE content_learnings cl
  SET status = 'WEAK', updated_at = now()
  FROM content_patterns cp
  WHERE cl.pattern_id = cp.id AND cl.workspace_id = p_workspace_id AND cp.platform = p_platform
    AND cp.status = 'WEAK' AND cl.status = 'ACTIVE';
END;
$$;

CREATE OR REPLACE FUNCTION generate_recommendations_from_learnings(p_workspace_id uuid, p_platform text)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_type_map jsonb := '{"content_pillar":"CONTENT_PILLAR","hook_type":"HOOK","format":"FORMAT","cta_type":"CTA","posting_time_bucket":"POSTING_TIME"}'::jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = auth.uid()) THEN
    RETURN;
  END IF;

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
    AND v_type_map ? cp.dimension
  ON CONFLICT (workspace_id, learning_id)
  DO UPDATE SET
    recommendation = EXCLUDED.recommendation, reason = EXCLUDED.reason, evidence = EXCLUDED.evidence,
    confidence = EXCLUDED.confidence, expected_impact = EXCLUDED.expected_impact, updated_at = now()
  WHERE content_recommendations.status IN ('NEW', 'VIEWED');
END;
$$;

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
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = auth.uid()) THEN
    RETURN;
  END IF;

  FOREACH v_dimension IN ARRAY ARRAY['content_pillar', 'hook_type', 'format']
  LOOP
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
      CASE WHEN v_top.repeat_ratio >= 0.7 AND v_trend = 'declining' THEN 'warning' ELSE 'ok' END,
      now()
    )
    ON CONFLICT (workspace_id, platform, dimension)
    DO UPDATE SET value = EXCLUDED.value, window_sample_size = EXCLUDED.window_sample_size,
      repeat_ratio = EXCLUDED.repeat_ratio, performance_trend = EXCLUDED.performance_trend,
      status = EXCLUDED.status, detected_at = now();

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

CREATE OR REPLACE FUNCTION run_content_learning_cycle(p_workspace_id uuid, p_platform text)
RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = p_workspace_id AND user_id = auth.uid()) THEN
    RETURN;
  END IF;

  PERFORM compute_content_performance_baseline(p_workspace_id, p_platform, NULL);
  PERFORM detect_content_patterns(p_workspace_id, p_platform);
  PERFORM generate_learnings_from_patterns(p_workspace_id, p_platform);
  PERFORM generate_recommendations_from_learnings(p_workspace_id, p_platform);
  PERFORM detect_content_fatigue(p_workspace_id, p_platform);
END;
$$;
