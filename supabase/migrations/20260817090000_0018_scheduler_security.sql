-- Scheduler authentication hardening.
-- The cron secret is stored in Supabase Vault; this function exposes it only
-- to the service_role used inside Edge Functions, never to API callers.
CREATE OR REPLACE FUNCTION public.get_scheduler_cron_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'socialpilot_scheduler_cron_secret'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_scheduler_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_scheduler_cron_secret() TO service_role;

-- Replace the hard-coded Authorization header in the existing one-minute job.
-- The job still calls the same function, but obtains the secret inside the
-- database from Vault at execution time.
DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'scheduler-tick-every-minute'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.alter_job(
      job_id := v_job_id,
      command := $cmd$
        select net.http_post(
          url := 'https://iqbuedqugkpxqdrzhfzn.supabase.co/functions/v1/scheduler-tick',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (
              select decrypted_secret
              from vault.decrypted_secrets
              where name = 'socialpilot_scheduler_cron_secret'
              limit 1
            )
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 20000
        );
      $cmd$
    );
  END IF;
END $$;
