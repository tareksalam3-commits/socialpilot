/*
  Automatic Audience Intelligence

  Audience data is no longer entered manually.  This migration turns the
  existing audience_profiles row into a read-only, AI-maintained profile:
  - Brand Voice changes queue a fresh inference immediately.
  - New high-confidence learning signals queue a throttled refresh.
  - A scheduler-driven worker claims jobs independently of the browser.
  - The final write is revision-checked, so an older model response can never
    overwrite a newer Brand Voice save.
*/

ALTER TABLE public.audience_profiles
  ADD COLUMN IF NOT EXISTS inference_status text NOT NULL DEFAULT 'idle'
    CHECK (inference_status IN ('idle', 'queued', 'analyzing', 'ready', 'failed', 'needs_brand_context')),
  ADD COLUMN IF NOT EXISTS inference_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS inference_error text,
  ADD COLUMN IF NOT EXISTS inferred_at timestamptz,
  ADD COLUMN IF NOT EXISTS learning_refreshed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.audience_inference_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  requested_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  requested_revision integer NOT NULL DEFAULT 1,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  error text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audience_inference_jobs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audience_inference_jobs_claim
  ON public.audience_inference_jobs(status, next_retry_at, requested_at);

DROP POLICY IF EXISTS "select_membership_audience_inference_jobs" ON public.audience_inference_jobs;
CREATE POLICY "select_membership_audience_inference_jobs"
  ON public.audience_inference_jobs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = audience_inference_jobs.workspace_id
        AND m.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.set_audience_inference_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audience_inference_jobs_updated_at ON public.audience_inference_jobs;
CREATE TRIGGER trg_audience_inference_jobs_updated_at
  BEFORE UPDATE ON public.audience_inference_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_audience_inference_jobs_updated_at();

CREATE OR REPLACE FUNCTION public.queue_audience_inference(
  p_workspace_id uuid,
  p_requested_by uuid,
  p_force boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audience_inference_jobs (
    workspace_id, requested_by, status, requested_revision, attempt_count,
    next_retry_at, error, requested_at, locked_at, locked_by, completed_at
  )
  VALUES (
    p_workspace_id, p_requested_by, 'queued', 1, 0,
    now(), NULL, now(), NULL, NULL, NULL
  )
  ON CONFLICT (workspace_id) DO UPDATE
  SET
    requested_by = EXCLUDED.requested_by,
    status = 'queued',
    requested_revision = public.audience_inference_jobs.requested_revision + 1,
    attempt_count = 0,
    next_retry_at = now(),
    error = NULL,
    requested_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    completed_at = NULL
  WHERE p_force
     OR (
       public.audience_inference_jobs.status <> 'running'
       AND public.audience_inference_jobs.requested_at < now() - interval '6 hours'
     );

  UPDATE public.audience_profiles
  SET
    inference_status = 'queued',
    inference_error = NULL,
    updated_at = now()
  WHERE workspace_id = p_workspace_id
    AND EXISTS (
      SELECT 1 FROM public.audience_inference_jobs j
      WHERE j.workspace_id = p_workspace_id AND j.status = 'queued'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.queue_audience_inference_for_brand_voice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.workspaces WHERE id = NEW.workspace_id;
  IF v_owner_id IS NOT NULL THEN
    PERFORM public.queue_audience_inference(NEW.workspace_id, v_owner_id, true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_audience_inference_from_brand_voice ON public.brand_voice;
CREATE TRIGGER trg_queue_audience_inference_from_brand_voice
  AFTER UPDATE OF
    business_name, description, industry, writing_style, tone, keywords,
    negative_keywords, cta_style, emoji_style, formality, voice,
    sentence_style, hook_style, hashtag_policy, content_length,
    brand_values, audience_relationship
  ON public.brand_voice
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_audience_inference_for_brand_voice();

CREATE OR REPLACE FUNCTION public.queue_audience_inference_from_learning()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  IF NEW.status = 'ACTIVE' AND COALESCE(NEW.confidence, 0) >= 0.65 AND NEW.sample_size >= 5 THEN
    SELECT owner_id INTO v_owner_id FROM public.workspaces WHERE id = NEW.workspace_id;
    IF v_owner_id IS NOT NULL THEN
      PERFORM public.queue_audience_inference(NEW.workspace_id, v_owner_id, false);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_audience_inference_from_learning ON public.content_learnings;
CREATE TRIGGER trg_queue_audience_inference_from_learning
  AFTER INSERT OR UPDATE OF status, confidence, sample_size, learning, evidence
  ON public.content_learnings
  FOR EACH ROW
  EXECUTE FUNCTION public.queue_audience_inference_from_learning();

CREATE OR REPLACE FUNCTION public.enqueue_due_audience_inferences(p_limit integer DEFAULT 3)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT w.id AS workspace_id, w.owner_id
    FROM public.workspaces w
    JOIN public.brand_voice bv ON bv.workspace_id = w.id
    LEFT JOIN public.audience_profiles ap ON ap.workspace_id = w.id
    WHERE (
      COALESCE(NULLIF(trim(bv.business_name), ''), NULLIF(trim(bv.description), ''), NULLIF(trim(bv.industry), '')) IS NOT NULL
    )
    AND (
      ap.inferred_at IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.content_learnings cl
        WHERE cl.workspace_id = w.id
          AND cl.status = 'ACTIVE'
          AND COALESCE(cl.confidence, 0) >= 0.65
          AND cl.sample_size >= 5
          AND cl.updated_at > COALESCE(ap.learning_refreshed_at, 'epoch'::timestamptz)
      )
    )
    ORDER BY COALESCE(ap.inferred_at, 'epoch'::timestamptz) ASC
    LIMIT GREATEST(1, LEAST(p_limit, 10))
  LOOP
    PERFORM public.queue_audience_inference(v_row.workspace_id, v_row.owner_id, false);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_audience_inference_job(p_worker_id text)
RETURNS SETOF public.audience_inference_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.audience_inference_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job
  FROM public.audience_inference_jobs
  WHERE (
      (status = 'queued' AND next_retry_at <= now())
      OR (status = 'running' AND locked_at < now() - interval '10 minutes')
      OR (status = 'failed' AND attempt_count < max_attempts AND next_retry_at <= now())
    )
  ORDER BY requested_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.audience_inference_jobs
  SET
    status = 'running',
    locked_at = now(),
    locked_by = p_worker_id,
    started_at = now(),
    attempt_count = v_job.attempt_count + 1,
    error = NULL
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  UPDATE public.audience_profiles
  SET inference_status = 'analyzing', inference_error = NULL, updated_at = now()
  WHERE workspace_id = v_job.workspace_id;

  RETURN NEXT v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_audience_inference_job(
  p_job_id uuid,
  p_requested_revision integer,
  p_worker_id text,
  p_profile jsonb,
  p_evidence jsonb,
  p_learning_refreshed_at timestamptz DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_persona text;
  v_awareness text;
  v_intent text;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.audience_inference_jobs
  WHERE id = p_job_id
    AND status = 'running'
    AND locked_by = p_worker_id
    AND requested_revision = p_requested_revision
  FOR UPDATE;

  IF v_workspace_id IS NULL THEN
    RETURN false;
  END IF;

  v_persona := NULLIF(trim(COALESCE(p_profile ->> 'persona', '')), '');
  v_awareness := CASE
    WHEN p_profile ->> 'awareness_level' IN ('unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware')
      THEN p_profile ->> 'awareness_level'
    ELSE NULL
  END;
  v_intent := CASE
    WHEN p_profile ->> 'purchase_intent' IN ('low', 'medium', 'high')
      THEN p_profile ->> 'purchase_intent'
    ELSE NULL
  END;

  INSERT INTO public.audience_profiles (
    workspace_id, persona, pain_points, desires, motivations, objections,
    awareness_level, interests, preferred_content, language_style,
    purchase_intent, inference_status, inference_sources, inference_error,
    inferred_at, learning_refreshed_at, updated_at
  )
  VALUES (
    v_workspace_id,
    v_persona,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile -> 'pain_points', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile -> 'desires', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile -> 'motivations', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile -> 'objections', '[]'::jsonb))),
    v_awareness,
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile -> 'interests', '[]'::jsonb))),
    ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_profile -> 'preferred_content', '[]'::jsonb))),
    NULLIF(trim(COALESCE(p_profile ->> 'language_style', '')), ''),
    v_intent,
    'ready', p_evidence, NULL, now(), p_learning_refreshed_at, now()
  )
  ON CONFLICT (workspace_id) DO UPDATE SET
    persona = EXCLUDED.persona,
    pain_points = EXCLUDED.pain_points,
    desires = EXCLUDED.desires,
    motivations = EXCLUDED.motivations,
    objections = EXCLUDED.objections,
    awareness_level = EXCLUDED.awareness_level,
    interests = EXCLUDED.interests,
    preferred_content = EXCLUDED.preferred_content,
    language_style = EXCLUDED.language_style,
    purchase_intent = EXCLUDED.purchase_intent,
    inference_status = 'ready',
    inference_sources = EXCLUDED.inference_sources,
    inference_error = NULL,
    inferred_at = now(),
    learning_refreshed_at = EXCLUDED.learning_refreshed_at,
    updated_at = now();

  -- `brand_voice.audience` remains a backward-compatible AI context summary;
  -- it is only ever written by this trusted automatic inference path.
  UPDATE public.brand_voice
  SET audience = v_persona, updated_at = now()
  WHERE workspace_id = v_workspace_id;

  UPDATE public.audience_inference_jobs
  SET
    status = 'complete',
    completed_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    error = NULL
  WHERE id = p_job_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_audience_inference_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_status text;
BEGIN
  UPDATE public.audience_inference_jobs
  SET
    status = CASE WHEN attempt_count >= max_attempts THEN 'failed' ELSE 'queued' END,
    next_retry_at = CASE
      WHEN attempt_count >= max_attempts THEN now()
      ELSE now() + make_interval(mins => LEAST(30, GREATEST(2, attempt_count * 3)))
    END,
    locked_at = NULL,
    locked_by = NULL,
    error = left(COALESCE(p_error, 'Audience inference failed'), 1000)
  WHERE id = p_job_id AND status = 'running' AND locked_by = p_worker_id
  RETURNING workspace_id, status INTO v_workspace_id, v_status;

  IF v_workspace_id IS NOT NULL THEN
    UPDATE public.audience_profiles
    SET
      inference_status = CASE WHEN v_status = 'failed' THEN 'failed' ELSE 'queued' END,
      inference_error = CASE WHEN v_status = 'failed' THEN left(COALESCE(p_error, 'Audience inference failed'), 1000) ELSE NULL END,
      updated_at = now()
    WHERE workspace_id = v_workspace_id;
  END IF;
END;
$$;

-- Existing workspaces receive an initial profile automatically on the next
-- scheduler tick. No historic manually-entered audience value is used as a
-- source; Brand Voice and validated learning signals are the inputs instead.
SELECT public.enqueue_due_audience_inferences(10);
