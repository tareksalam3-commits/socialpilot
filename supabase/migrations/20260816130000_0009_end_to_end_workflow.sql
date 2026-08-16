-- End-to-end workflow hardening. All additions are backward-compatible.
ALTER TABLE public.content
  ADD COLUMN IF NOT EXISTS batch_id uuid,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_score numeric,
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.content
  DROP CONSTRAINT IF EXISTS content_quality_status_check;
ALTER TABLE public.content
  ADD CONSTRAINT content_quality_status_check CHECK (quality_status IN ('pending','passed','needs_improvement','failed'));

ALTER TABLE public.content_variants
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_score numeric,
  ADD COLUMN IF NOT EXISTS quality_status text NOT NULL DEFAULT 'pending';

ALTER TABLE public.content_variants
  DROP CONSTRAINT IF EXISTS content_variants_quality_status_check;
ALTER TABLE public.content_variants
  ADD CONSTRAINT content_variants_quality_status_check CHECK (quality_status IN ('pending','passed','needs_improvement','failed'));

CREATE INDEX IF NOT EXISTS idx_content_batch ON public.content(workspace_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_content_scheduled_at ON public.content(workspace_id, scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_variant ON public.calendar_items(workspace_id, variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_content ON public.calendar_items(workspace_id, content_id);

ALTER TABLE public.publishing_jobs
  ADD COLUMN IF NOT EXISTS external_post_id text,
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_publishing_external_post ON public.publishing_jobs(workspace_id, external_post_id);

CREATE TABLE IF NOT EXISTS public.post_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.content(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.content_variants(id) ON DELETE CASCADE,
  publishing_job_id uuid REFERENCES public.publishing_jobs(id) ON DELETE SET NULL,
  metric text NOT NULL,
  value numeric NOT NULL,
  timestamp timestamptz NOT NULL,
  platform text NOT NULL,
  external_post_id text,
  source text NOT NULL DEFAULT 'social_api',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.post_insights ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_post_insights_content ON public.post_insights(workspace_id, content_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_post_insights_platform ON public.post_insights(workspace_id, platform, metric, timestamp);
CREATE UNIQUE INDEX IF NOT EXISTS uq_post_insight_snapshot
  ON public.post_insights(workspace_id, external_post_id, platform, metric, timestamp)
  WHERE external_post_id IS NOT NULL;

DROP POLICY IF EXISTS "pi_select_member" ON public.post_insights;
CREATE POLICY "pi_select_member" ON public.post_insights FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "pi_insert_member" ON public.post_insights;
CREATE POLICY "pi_insert_member" ON public.post_insights FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "pi_update_member" ON public.post_insights;
CREATE POLICY "pi_update_member" ON public.post_insights FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "pi_delete_member" ON public.post_insights;
CREATE POLICY "pi_delete_member" ON public.post_insights FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

CREATE OR REPLACE FUNCTION public.approve_content_variant(
  p_workspace_id uuid,
  p_variant_id uuid,
  p_scheduled_for timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_variant public.content_variants;
  v_calendar public.calendar_items;
BEGIN
  SELECT * INTO v_variant FROM public.content_variants
  WHERE id = p_variant_id AND workspace_id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'variant_not_found'; END IF;
  IF v_variant.quality_status IN ('needs_improvement','failed') THEN RAISE EXCEPTION 'quality_review_required'; END IF;

  UPDATE public.content_variants SET status = 'approved' WHERE id = p_variant_id;
  SELECT * INTO v_calendar FROM public.calendar_items
  WHERE workspace_id = p_workspace_id AND variant_id = p_variant_id
  LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    UPDATE public.calendar_items
    SET scheduled_for = COALESCE(p_scheduled_for, scheduled_for), status = 'scheduled'
    WHERE id = v_calendar.id;
  ELSE
    INSERT INTO public.calendar_items (workspace_id, content_id, variant_id, platform, scheduled_for, status)
    VALUES (p_workspace_id, v_variant.content_id, v_variant.id, v_variant.platform,
      COALESCE(p_scheduled_for, now() + interval '1 day'), 'scheduled')
    RETURNING * INTO v_calendar;
  END IF;

  UPDATE public.content SET status = 'scheduled', scheduled_at = v_calendar.scheduled_for
  WHERE id = v_variant.content_id AND workspace_id = p_workspace_id;

  INSERT INTO public.publishing_jobs (workspace_id, variant_id, calendar_item_id, idempotency_key, action, status, scheduled_for, platform)
  VALUES (p_workspace_id, v_variant.id, v_calendar.id,
    concat(p_workspace_id, ':', v_variant.id, ':', to_char(v_calendar.scheduled_for, 'YYYYMMDDHH24MISSMS')), 'schedule', 'queued', v_calendar.scheduled_for, v_variant.platform)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN jsonb_build_object('variant_id', v_variant.id, 'calendar_item_id', v_calendar.id, 'scheduled_for', v_calendar.scheduled_for);
END;
$$;
