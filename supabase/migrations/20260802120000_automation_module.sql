/*
# Automation Module

## Modified Tables
- `workspaces` — adds `auto_publish_enabled` (default true). When false, the
  cron scheduler skips this workspace entirely (no auto-firing of due
  scheduled posts, no automatic retries of failed targets). Manual actions
  (Publish Now, manual retry, manual "run now") still work regardless of
  this flag — it only gates the unattended background behaviour.

## New Functions
- `get_scheduler_status()` — SECURITY DEFINER read of `cron.job` /
  `cron.job_run_details` for the `run-scheduler-every-minute` job, exposed
  to `authenticated` so the Automation UI can show whether the background
  job is active and when it last ran/succeeded. This table lives outside
  `public` and isn't reachable through PostgREST otherwise, and contains no
  workspace-specific data, so a single global read is safe to expose.

## Notes
No new tables are needed — the automation module (Publishing Queue, Failed
Queue, Scheduled Jobs, Job Status, Execution Logs) reads directly from the
existing `posts`, `post_platform_targets`, and `publishing_logs` tables,
all of which already carry workspace-scoped RLS. Retry actions go through
the `automation-control` edge function, which uses the service-role key
and re-checks workspace membership itself (client roles have no UPDATE
policy on `post_platform_targets`, by design).
*/

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS auto_publish_enabled boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.get_scheduler_status()
RETURNS TABLE (
  job_name text,
  schedule text,
  active boolean,
  last_run_at timestamptz,
  last_run_status text,
  last_run_return_message text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, cron
AS $$
  SELECT
    j.jobname,
    j.schedule,
    j.active,
    r.start_time,
    r.status,
    r.return_message
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT d.start_time, d.status, d.return_message
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC
    LIMIT 1
  ) r ON true
  WHERE j.jobname = 'run-scheduler-every-minute';
$$;

GRANT EXECUTE ON FUNCTION public.get_scheduler_status() TO authenticated;
