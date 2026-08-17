-- Inbox persistence, webhook idempotency, and least-privilege hardening.

CREATE TABLE IF NOT EXISTS public.inbox_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  type text NOT NULL CHECK (type IN ('dm', 'comment')),
  external_id text NOT NULL,
  external_participant_id text,
  sender_name text,
  snippet text,
  unread boolean NOT NULL DEFAULT true,
  needs_review boolean NOT NULL DEFAULT false,
  content_id uuid REFERENCES public.content(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.inbox_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content text NOT NULL,
  is_ai boolean NOT NULL DEFAULT false,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  external_id text,
  sender_external_id text,
  sender_name text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.inbox_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_messages ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_conversation_external
  ON public.inbox_conversations(account_id, platform, type, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_message_external
  ON public.inbox_messages(conversation_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_conv_ws_updated
  ON public.inbox_conversations(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_account
  ON public.inbox_conversations(account_id, platform, type);
CREATE INDEX IF NOT EXISTS idx_inbox_conv_content
  ON public.inbox_conversations(content_id)
  WHERE content_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_msg_conv_time
  ON public.inbox_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_msg_ws
  ON public.inbox_messages(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inbox_msg_user
  ON public.inbox_messages(user_id)
  WHERE user_id IS NOT NULL;

DROP POLICY IF EXISTS "ic_select_member" ON public.inbox_conversations;
CREATE POLICY "ic_select_member" ON public.inbox_conversations FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ic_update_member" ON public.inbox_conversations;
CREATE POLICY "ic_update_member" ON public.inbox_conversations FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);

DROP POLICY IF EXISTS "im_select_member" ON public.inbox_messages;
CREATE POLICY "im_select_member" ON public.inbox_messages FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);

-- These helpers are used by triggers or authenticated server paths, not by anonymous callers.
REVOKE EXECUTE ON FUNCTION public.am_i_platform_admin() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_workspace() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_inbox_conversation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_inbox_conversation() FROM anon;

DROP TRIGGER IF EXISTS trg_touch_inbox_conversations ON public.inbox_conversations;
CREATE TRIGGER trg_touch_inbox_inbox_conversations
BEFORE UPDATE ON public.inbox_conversations
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
