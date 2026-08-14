-- ============================================================
-- Notification Center
-- ============================================================
-- This migration:
--   1. Fixes a bug where `notifications` had REPLICA IDENTITY FULL set
--      (phase3 migration) but was never added to the `supabase_realtime`
--      publication, so the frontend's postgres_changes subscription
--      (notificationRepository.subscribe / useNotifications) silently
--      never received INSERT/UPDATE/DELETE events.
--   2. Adds server-side triggers so "AI Events", "Security Alerts", and
--      "Workspace Notifications" are actually populated, matching the
--      publishing_success / publishing_failure notifications already
--      created by the publish-post edge function.

-- ------------------------------------------------------------
-- 1. Bug fix: register `notifications` on the realtime publication
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Helper functions
-- ------------------------------------------------------------

-- Insert a single notification for one user.
CREATE OR REPLACE FUNCTION public.fn_notify_user(
  p_workspace_id uuid,
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (workspace_id, user_id, type, title, message, metadata)
  VALUES (p_workspace_id, p_user_id, p_type, p_title, p_message, p_metadata);
END;
$$;

-- Fan a notification out to every member of a workspace (optionally skipping one user,
-- e.g. the actor who triggered the event).
CREATE OR REPLACE FUNCTION public.fn_notify_workspace(
  p_workspace_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_skip_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notifications (workspace_id, user_id, type, title, message, metadata)
  SELECT p_workspace_id, m.user_id, p_type, p_title, p_message, p_metadata
  FROM workspace_members m
  WHERE m.workspace_id = p_workspace_id
    AND (p_skip_user_id IS NULL OR m.user_id <> p_skip_user_id);
END;
$$;

-- ------------------------------------------------------------
-- 3. AI Events — notify the user when a real content-generation
--    job finishes (skip chat/playground/command-bar turns, which
--    would otherwise flood the notification center).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_notify_ai_event() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.type LIKE 'content_%' OR NEW.type LIKE 'generator_%' THEN
    IF NEW.status = 'success' THEN
      PERFORM fn_notify_user(
        NEW.workspace_id, NEW.user_id, 'ai_event',
        'AI content ready',
        'Your ' || replace(NEW.type, '_', ' ') || ' request finished generating.',
        jsonb_build_object('ai_history_id', NEW.id, 'ai_type', NEW.type)
      );
    ELSIF NEW.status IN ('failed', 'timeout') THEN
      PERFORM fn_notify_user(
        NEW.workspace_id, NEW.user_id, 'ai_event',
        'AI generation failed',
        'Your ' || replace(NEW.type, '_', ' ') || ' request did not complete.',
        jsonb_build_object('ai_history_id', NEW.id, 'ai_type', NEW.type)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_ai_event ON ai_history;
CREATE TRIGGER notify_ai_event
  AFTER INSERT ON ai_history
  FOR EACH ROW EXECUTE FUNCTION trg_notify_ai_event();

-- ------------------------------------------------------------
-- 4. Security Alerts
-- ------------------------------------------------------------

-- a) A connected account starts failing / gets disconnected.
CREATE OR REPLACE FUNCTION public.trg_notify_account_health() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.health_status = 'error' AND OLD.health_status IS DISTINCT FROM 'error')
     OR (NEW.status = 'disconnected' AND OLD.status IS DISTINCT FROM 'disconnected') THEN
    PERFORM fn_notify_workspace(
      NEW.workspace_id, 'security_alert',
      'Connected account needs attention',
      coalesce(NEW.handle, initcap(NEW.platform)) || ' on ' || NEW.platform || ' is ' ||
        CASE WHEN NEW.status = 'disconnected' THEN 'disconnected' ELSE 'reporting errors' END || '.',
      jsonb_build_object('account_id', NEW.id, 'platform', NEW.platform)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_account_health ON connected_accounts;
CREATE TRIGGER notify_account_health
  AFTER UPDATE ON connected_accounts
  FOR EACH ROW EXECUTE FUNCTION trg_notify_account_health();

-- b) API key created / revoked.
CREATE OR REPLACE FUNCTION public.trg_notify_api_key_created() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM fn_notify_workspace(
    NEW.workspace_id, 'security_alert',
    'New API key created',
    '"' || NEW.label || '" was added to your workspace.',
    jsonb_build_object('api_key_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_api_key_created ON api_keys;
CREATE TRIGGER notify_api_key_created
  AFTER INSERT ON api_keys
  FOR EACH ROW EXECUTE FUNCTION trg_notify_api_key_created();

CREATE OR REPLACE FUNCTION public.trg_notify_api_key_revoked() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    PERFORM fn_notify_workspace(
      NEW.workspace_id, 'security_alert',
      'API key revoked',
      '"' || NEW.label || '" was revoked and can no longer be used.',
      jsonb_build_object('api_key_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_api_key_revoked ON api_keys;
CREATE TRIGGER notify_api_key_revoked
  AFTER UPDATE ON api_keys
  FOR EACH ROW EXECUTE FUNCTION trg_notify_api_key_revoked();

-- ------------------------------------------------------------
-- 5. Workspace Notifications
-- ------------------------------------------------------------

-- a) A new member joins the workspace (skip the very first member, i.e.
--    the owner row created at workspace setup — nothing to announce yet).
CREATE OR REPLACE FUNCTION public.trg_notify_member_joined() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_count integer;
  v_name text;
BEGIN
  SELECT count(*) INTO v_member_count FROM workspace_members WHERE workspace_id = NEW.workspace_id;
  IF v_member_count > 1 THEN
    SELECT full_name INTO v_name FROM profiles WHERE user_id = NEW.user_id;
    PERFORM fn_notify_workspace(
      NEW.workspace_id, 'workspace_event',
      'New team member',
      coalesce(v_name, 'A new member') || ' joined the workspace as ' || NEW.role || '.',
      jsonb_build_object('member_user_id', NEW.user_id, 'role', NEW.role),
      NEW.user_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_member_joined ON workspace_members;
CREATE TRIGGER notify_member_joined
  AFTER INSERT ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION trg_notify_member_joined();

-- b) An invitation is accepted.
CREATE OR REPLACE FUNCTION public.trg_notify_invitation_accepted() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    PERFORM fn_notify_workspace(
      NEW.workspace_id, 'workspace_event',
      'Invitation accepted',
      NEW.email || ' accepted their invitation to join the workspace.',
      jsonb_build_object('invitation_id', NEW.id, 'email', NEW.email)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_invitation_accepted ON workspace_invitations;
CREATE TRIGGER notify_invitation_accepted
  AFTER UPDATE ON workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION trg_notify_invitation_accepted();
