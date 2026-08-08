/*
# Publishing Engine — Queue, Retry, Cron

## Modified Tables
- `post_platform_targets` — adds retry bookkeeping (`retry_count`, `max_retries`,
  `next_retry_at`) so a failed target can be automatically retried with
  backoff instead of staying failed forever.

## New Tables
- `publishing_logs` — append-only audit trail of every publish attempt
  (queued, attempt, success, failure, retry-scheduled, gave-up). Powers the
  "Publishing Logs" panel.
- `app_secrets` — holds the service-role key and functions base URL so the
  cron job can call the `run-scheduler` edge function. No RLS policies are
  defined for `anon`/`authenticated`, so with RLS enabled the table is
  unreadable/unwritable from the client entirely; only migrations (as the
  table owner) and SECURITY DEFINER functions can touch it.

## Automation
- `pg_cron` fires `trigger_scheduler()` every minute, which POSTs to the
  `run-scheduler` edge function via `pg_net`. That function publishes any
  post whose `scheduled_for` has arrived and retries any failed target whose
  `next_retry_at` has arrived.

## Security
- RLS on `publishing_logs`, scoped to workspace membership (read-only for
  clients; edge functions write via the service-role key).
- `app_secrets` has RLS enabled with zero policies — nobody using the anon
  or authenticated role can select/insert/update/delete it, by design.
*/

ALTER TABLE post_platform_targets
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_post_platform_targets_retry
  ON post_platform_targets (status, next_retry_at)
  WHERE status = 'failed';

CREATE TABLE IF NOT EXISTS publishing_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  target_id uuid REFERENCES post_platform_targets(id) ON DELETE CASCADE,
  platform text,
  event text NOT NULL CHECK (event IN ('queued', 'attempt', 'success', 'failure', 'retry_scheduled', 'gave_up')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE publishing_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_publishing_logs_workspace_created ON publishing_logs (workspace_id, created_at DESC);

DROP POLICY IF EXISTS "select_membership_publishing_logs" ON publishing_logs;
CREATE POLICY "select_membership_publishing_logs" ON publishing_logs FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = publishing_logs.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- Cron wiring
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS app_secrets (
  key text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: RLS with no policies denies all client access.

CREATE OR REPLACE FUNCTION public.trigger_scheduler()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT value INTO v_url FROM app_secrets WHERE key = 'functions_base_url';
  SELECT value INTO v_key FROM app_secrets WHERE key = 'service_role_key';

  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN; -- not configured yet — see setup instructions
  END IF;

  PERFORM net.http_post(
    url := v_url || '/run-scheduler',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
END;
$$;

SELECT cron.schedule('run-scheduler-every-minute', '* * * * *', 'SELECT public.trigger_scheduler();')
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-scheduler-every-minute');

-- ============================================================
-- Realtime: let the frontend live-update when the cron scheduler
-- publishes/retries a post in the background (Calendar "Live Updates").
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'posts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE posts;
  END IF;
END $$;
