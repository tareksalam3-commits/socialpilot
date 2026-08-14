/*
  Background worker HTTP timeouts

  AI-backed queue workers can require more than the default 5 seconds used by
  pg_net.  Keep the scheduler request alive long enough for the edge function
  to claim a job, call the AI gateway, persist its checkpoint and respond.
*/

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
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/run-scheduler',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_generation_worker()
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
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/content-generation-worker',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
END;
$$;
