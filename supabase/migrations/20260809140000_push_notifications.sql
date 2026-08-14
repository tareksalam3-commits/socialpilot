-- ============================================================
-- Web Push notifications
-- ============================================================
-- Adds per-device push subscriptions and wires a trigger so every row
-- inserted into `notifications` (already populated by publish-post and the
-- notification_center triggers) also fires a real OS-level push to any
-- devices the target user has subscribed, via the `send-push` edge function.
--
-- Mirrors the existing `trigger_scheduler()` / `app_secrets` pattern from
-- 20260801010000_publishing_engine_schema.sql — reuses the same
-- `functions_base_url` / `service_role_key` secrets, so if you already
-- configured those for the scheduler, push notifications need no extra
-- app_secrets setup beyond the VAPID keys (set as Edge Function secrets,
-- see supabase/functions/send-push).

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

DROP POLICY IF EXISTS "select_own_push_subscriptions" ON push_subscriptions;
CREATE POLICY "select_own_push_subscriptions" ON push_subscriptions FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "insert_own_push_subscriptions" ON push_subscriptions;
CREATE POLICY "insert_own_push_subscriptions" ON push_subscriptions FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "update_own_push_subscriptions" ON push_subscriptions;
CREATE POLICY "update_own_push_subscriptions" ON push_subscriptions FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "delete_own_push_subscriptions" ON push_subscriptions;
CREATE POLICY "delete_own_push_subscriptions" ON push_subscriptions FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ------------------------------------------------------------
-- Trigger: fan out a real push whenever a notification is inserted.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_push_on_notification() RETURNS trigger
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
    RETURN NEW; -- not configured yet — see README setup instructions
  END IF;

  -- Only bother calling out if this user actually has a device subscribed;
  -- avoids an HTTP round trip for the common case of no push set up.
  IF EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = NEW.user_id) THEN
    PERFORM net.http_post(
      url := v_url || '/send-push',
      headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'user_id', NEW.user_id,
        'notification_id', NEW.id,
        'title', NEW.title,
        'body', NEW.message,
        'type', NEW.type
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_on_notification ON notifications;
CREATE TRIGGER push_on_notification
  AFTER INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION trg_push_on_notification();
