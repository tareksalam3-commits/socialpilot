-- Persistent AI Assistant campaigns
--
-- A campaign is stored before generation starts.  The database scheduler and
-- content-generation-worker then process one post at a time, independently of
-- the browser session.  Posts remain the single source of truth for content
-- workspace output; this table stores orchestration and resume state only.

CREATE TABLE IF NOT EXISTS public.content_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'collecting', 'creating', 'completed', 'cancelled')),
  phase text NOT NULL DEFAULT 'queued' CHECK (phase IN ('planning', 'audience', 'queued', 'collecting', 'creating', 'quality', 'review', 'completed', 'cancelled')),
  request_text text NOT NULL,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  post_count integer NOT NULL CHECK (post_count > 0),
  next_index integer NOT NULL DEFAULT 0 CHECK (next_index >= 0),
  source_context text,
  used_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  images_enabled boolean NOT NULL DEFAULT false,
  last_error text,
  retry_count integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  locked_by text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  connected_platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_model text,
  ai_temperature numeric,
  ai_max_tokens integer,
  audience_inference jsonb,
  schedule_times jsonb NOT NULL DEFAULT '[]'::jsonb,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL
);

-- The production queue pre-dated this repository migration.  Keep the
-- migration idempotent for both existing environments and new installations.
ALTER TABLE public.content_generation_jobs
  ADD COLUMN IF NOT EXISTS used_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS images_enabled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_content_generation_jobs_workspace_resume
  ON public.content_generation_jobs (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_generation_jobs_queue
  ON public.content_generation_jobs (status, locked_at, created_at)
  WHERE status IN ('queued', 'collecting', 'creating');

ALTER TABLE public.content_generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_content_generation_jobs" ON public.content_generation_jobs;
CREATE POLICY "select_own_content_generation_jobs" ON public.content_generation_jobs FOR SELECT
  TO authenticated USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = content_generation_jobs.workspace_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "insert_own_content_generation_jobs" ON public.content_generation_jobs;
CREATE POLICY "insert_own_content_generation_jobs" ON public.content_generation_jobs FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = content_generation_jobs.workspace_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "update_own_content_generation_jobs" ON public.content_generation_jobs;
CREATE POLICY "update_own_content_generation_jobs" ON public.content_generation_jobs FOR UPDATE
  TO authenticated USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = content_generation_jobs.workspace_id
        AND m.user_id = auth.uid()
    )
  ) WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = content_generation_jobs.workspace_id
        AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "delete_own_content_generation_jobs" ON public.content_generation_jobs;
CREATE POLICY "delete_own_content_generation_jobs" ON public.content_generation_jobs FOR DELETE
  TO authenticated USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.workspace_members m
      WHERE m.workspace_id = content_generation_jobs.workspace_id
        AND m.user_id = auth.uid()
    )
  );

-- An atomic claim prevents two cron invocations from generating the same
-- content index.  A stale lock is recoverable, so a stopped worker cannot
-- strand a campaign.
CREATE OR REPLACE FUNCTION public.claim_content_generation_job(p_worker_id text)
RETURNS SETOF public.content_generation_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidate AS (
    SELECT id
    FROM public.content_generation_jobs
    WHERE status IN ('queued', 'collecting', 'creating')
      AND next_index < post_count
      AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.content_generation_jobs j
  SET locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  FROM candidate c
  WHERE j.id = c.id
  RETURNING j.*;
$$;

-- Every worker exit, including a transient provider failure, clears the lock.
-- Failed attempts return to the queue instead of becoming browser-bound work.
CREATE OR REPLACE FUNCTION public.touch_content_generation_job(
  p_job_id uuid,
  p_status text,
  p_phase text,
  p_next_index integer,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.content_generation_jobs
  SET status = p_status,
      phase = p_phase,
      next_index = p_next_index,
      last_error = p_error,
      retry_count = CASE WHEN p_error IS NULL THEN retry_count ELSE retry_count + 1 END,
      locked_at = NULL,
      locked_by = NULL,
      completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
      updated_at = now()
  WHERE id = p_job_id;
$$;

REVOKE ALL ON FUNCTION public.claim_content_generation_job(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_content_generation_job(uuid, text, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_content_generation_job(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.touch_content_generation_job(uuid, text, text, integer, text) TO service_role;

COMMENT ON TABLE public.content_generation_jobs IS
  'Persistent AI Assistant campaign orchestration. Generated content is saved to posts for Content Workspace review.';
COMMENT ON FUNCTION public.claim_content_generation_job(text) IS
  'Atomically claims one resumable content-generation job for the background worker.';
COMMENT ON FUNCTION public.touch_content_generation_job(uuid, text, text, integer, text) IS
  'Updates durable campaign progress, clears the worker lock, and preserves retryable failures.';
