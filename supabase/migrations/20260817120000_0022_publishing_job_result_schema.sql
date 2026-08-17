-- Keep the live publishing_jobs contract aligned with social-publish and scheduler-tick.
-- Both functions persist the verified platform response in result; without this
-- column PostgREST rejects the whole success update and leaves jobs running.
ALTER TABLE public.publishing_jobs
  ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.publishing_jobs.result IS
  'Verified platform publish response metadata; contains no access tokens or secrets.';
