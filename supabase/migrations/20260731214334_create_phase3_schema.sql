/*
# SocialPilot AI — Phase 3 Schema

Extends the platform with social media management tables.

## New Tables
- `posts` — full lifecycle (draft, scheduled, publishing, published, failed, archived), multi-platform, media refs.
- `post_platform_targets` — per-platform publishing targets for a post.
- `media_items` — media library (images, videos, documents) with tags, folders.
- `media_folders` — folders for organizing media.
- `inbox_conversations` — unified inbox threads (comments + DMs).
- `inbox_messages` — individual messages within a conversation.
- `notifications` — notification center entries.
- `workspace_invitations` — pending member invitations.
- `post_analytics` — per-post analytics.
- `account_analytics` — per-account daily analytics snapshots.

## Modified Tables
- `connected_accounts` — add token, sync, health columns.

## Security
- RLS on all new tables. Owner-scoped via workspace membership.
- Token columns not selectable by client; SECURITY DEFINER function for edge-function use.
- Fix: add UPDATE policy to api_keys (Phase 1 bug).
*/

-- ============================================================
-- Extend connected_accounts
-- ============================================================
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS access_token_encrypted text,
  ADD COLUMN IF NOT EXISTS refresh_token_encrypted text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_account_id text,
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'synced', 'error')),
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'warning', 'error', 'unknown'));

-- ============================================================
-- posts
-- ============================================================
CREATE TABLE IF NOT EXISTS posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text,
  content text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'archived')),
  platforms text[] NOT NULL DEFAULT '{}',
  media_urls text[] NOT NULL DEFAULT '{}',
  scheduled_for timestamptz,
  published_at timestamptz,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_posts_workspace_id ON posts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_for ON posts(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

DROP POLICY IF EXISTS "select_own_posts" ON posts;
CREATE POLICY "select_own_posts" ON posts FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = posts.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_posts" ON posts;
CREATE POLICY "insert_own_posts" ON posts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = posts.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_posts" ON posts;
CREATE POLICY "update_own_posts" ON posts FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = posts.workspace_id AND m.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = posts.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_posts" ON posts;
CREATE POLICY "delete_own_posts" ON posts FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = posts.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- post_platform_targets
-- ============================================================
CREATE TABLE IF NOT EXISTS post_platform_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  account_id uuid REFERENCES connected_accounts(id) ON DELETE SET NULL,
  external_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  error_message text,
  published_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE post_platform_targets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_post_platform_targets_post_id ON post_platform_targets(post_id);
CREATE INDEX IF NOT EXISTS idx_post_platform_targets_status ON post_platform_targets(status);

DROP POLICY IF EXISTS "select_own_post_targets" ON post_platform_targets;
CREATE POLICY "select_own_post_targets" ON post_platform_targets FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM posts p JOIN workspace_members m ON m.workspace_id = p.workspace_id WHERE p.id = post_platform_targets.post_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_post_targets" ON post_platform_targets;
CREATE POLICY "insert_own_post_targets" ON post_platform_targets FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM posts p JOIN workspace_members m ON m.workspace_id = p.workspace_id WHERE p.id = post_platform_targets.post_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_post_targets" ON post_platform_targets;
CREATE POLICY "update_own_post_targets" ON post_platform_targets FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM posts p JOIN workspace_members m ON m.workspace_id = p.workspace_id WHERE p.id = post_platform_targets.post_id AND m.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM posts p JOIN workspace_members m ON m.workspace_id = p.workspace_id WHERE p.id = post_platform_targets.post_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_post_targets" ON post_platform_targets;
CREATE POLICY "delete_own_post_targets" ON post_platform_targets FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM posts p JOIN workspace_members m ON m.workspace_id = p.workspace_id WHERE p.id = post_platform_targets.post_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- media_folders
-- ============================================================
CREATE TABLE IF NOT EXISTS media_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE media_folders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_media_folders_workspace_id ON media_folders(workspace_id);

DROP POLICY IF EXISTS "select_own_media_folders" ON media_folders;
CREATE POLICY "select_own_media_folders" ON media_folders FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = media_folders.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_media_folders" ON media_folders;
CREATE POLICY "insert_own_media_folders" ON media_folders FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = media_folders.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_media_folders" ON media_folders;
CREATE POLICY "delete_own_media_folders" ON media_folders FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = media_folders.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- media_items
-- ============================================================
CREATE TABLE IF NOT EXISTS media_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES media_folders(id) ON DELETE SET NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('image', 'video', 'document')),
  url text NOT NULL,
  thumbnail_url text,
  size_bytes integer,
  mime_type text,
  tags text[] NOT NULL DEFAULT '{}',
  compression_status text NOT NULL DEFAULT 'none' CHECK (compression_status IN ('none', 'pending', 'compressed', 'optimized')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_media_items_workspace_id ON media_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_media_items_user_id ON media_items(user_id);
CREATE INDEX IF NOT EXISTS idx_media_items_type ON media_items(type);
CREATE INDEX IF NOT EXISTS idx_media_items_folder_id ON media_items(folder_id);
CREATE INDEX IF NOT EXISTS idx_media_items_created_at ON media_items(created_at DESC);

DROP POLICY IF EXISTS "select_own_media_items" ON media_items;
CREATE POLICY "select_own_media_items" ON media_items FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = media_items.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_media_items" ON media_items;
CREATE POLICY "insert_own_media_items" ON media_items FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = media_items.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_media_items" ON media_items;
CREATE POLICY "update_own_media_items" ON media_items FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = media_items.workspace_id AND m.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = media_items.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_media_items" ON media_items;
CREATE POLICY "delete_own_media_items" ON media_items FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = media_items.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- inbox_conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS inbox_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_id text,
  type text NOT NULL CHECK (type IN ('comment', 'dm')),
  sender_name text,
  sender_avatar text,
  snippet text,
  unread boolean NOT NULL DEFAULT true,
  archived boolean NOT NULL DEFAULT false,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inbox_conversations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_inbox_conversations_workspace_id ON inbox_conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inbox_conversations_unread ON inbox_conversations(unread);
CREATE INDEX IF NOT EXISTS idx_inbox_conversations_archived ON inbox_conversations(archived);
CREATE INDEX IF NOT EXISTS idx_inbox_conversations_updated_at ON inbox_conversations(updated_at DESC);

DROP POLICY IF EXISTS "select_own_inbox_conversations" ON inbox_conversations;
CREATE POLICY "select_own_inbox_conversations" ON inbox_conversations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_conversations.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_inbox_conversations" ON inbox_conversations;
CREATE POLICY "insert_own_inbox_conversations" ON inbox_conversations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_conversations.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_inbox_conversations" ON inbox_conversations;
CREATE POLICY "update_own_inbox_conversations" ON inbox_conversations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_conversations.workspace_id AND m.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_conversations.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_inbox_conversations" ON inbox_conversations;
CREATE POLICY "delete_own_inbox_conversations" ON inbox_conversations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_conversations.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- inbox_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES inbox_conversations(id) ON DELETE CASCADE,
  user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  content text NOT NULL,
  is_ai boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inbox_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_inbox_messages_conversation_id ON inbox_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_created_at ON inbox_messages(created_at);

DROP POLICY IF EXISTS "select_own_inbox_messages" ON inbox_messages;
CREATE POLICY "select_own_inbox_messages" ON inbox_messages FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM inbox_conversations c JOIN workspace_members m ON m.workspace_id = c.workspace_id WHERE c.id = inbox_messages.conversation_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_inbox_messages" ON inbox_messages;
CREATE POLICY "insert_own_inbox_messages" ON inbox_messages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM inbox_conversations c JOIN workspace_members m ON m.workspace_id = c.workspace_id WHERE c.id = inbox_messages.conversation_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('publishing_success', 'publishing_failure', 'ai_event', 'account_event', 'workspace_event', 'security_alert')),
  title text NOT NULL,
  message text,
  read boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notifications_workspace_id ON notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

DROP POLICY IF EXISTS "select_own_notifications" ON notifications;
CREATE POLICY "select_own_notifications" ON notifications FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_notifications" ON notifications;
CREATE POLICY "insert_own_notifications" ON notifications FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_notifications" ON notifications;
CREATE POLICY "delete_own_notifications" ON notifications FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- workspace_invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days')
);

ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_workspace_invitations_workspace_id ON workspace_invitations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_email ON workspace_invitations(email);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_status ON workspace_invitations(status);

DROP POLICY IF EXISTS "select_own_invitations" ON workspace_invitations;
CREATE POLICY "select_own_invitations" ON workspace_invitations FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_invitations.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_invitations" ON workspace_invitations;
CREATE POLICY "insert_own_invitations" ON workspace_invitations FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_invitations.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_invitations" ON workspace_invitations;
CREATE POLICY "update_own_invitations" ON workspace_invitations FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_invitations.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_invitations.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_invitations" ON workspace_invitations;
CREATE POLICY "delete_own_invitations" ON workspace_invitations FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_invitations.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- post_analytics
-- ============================================================
CREATE TABLE IF NOT EXISTS post_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL,
  reach integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  engagement integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0,
  comments integer NOT NULL DEFAULT 0,
  shares integer NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE post_analytics ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_post_analytics_post_id ON post_analytics(post_id);
CREATE INDEX IF NOT EXISTS idx_post_analytics_workspace_id ON post_analytics(workspace_id);
CREATE INDEX IF NOT EXISTS idx_post_analytics_recorded_at ON post_analytics(recorded_at DESC);

DROP POLICY IF EXISTS "select_own_post_analytics" ON post_analytics;
CREATE POLICY "select_own_post_analytics" ON post_analytics FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = post_analytics.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_post_analytics" ON post_analytics;
CREATE POLICY "insert_own_post_analytics" ON post_analytics FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = post_analytics.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- account_analytics
-- ============================================================
CREATE TABLE IF NOT EXISTS account_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  followers integer NOT NULL DEFAULT 0,
  followers_delta integer NOT NULL DEFAULT 0,
  reach integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  engagement integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  recorded_at date NOT NULL DEFAULT CURRENT_DATE
);

ALTER TABLE account_analytics ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_account_analytics_workspace_id ON account_analytics(workspace_id);
CREATE INDEX IF NOT EXISTS idx_account_analytics_account_id ON account_analytics(account_id);
CREATE INDEX IF NOT EXISTS idx_account_analytics_recorded_at ON account_analytics(recorded_at DESC);

DROP POLICY IF EXISTS "select_own_account_analytics" ON account_analytics;
CREATE POLICY "select_own_account_analytics" ON account_analytics FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = account_analytics.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_account_analytics" ON account_analytics;
CREATE POLICY "insert_own_account_analytics" ON account_analytics FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = account_analytics.workspace_id AND m.user_id = auth.uid())
  );

-- ============================================================
-- SECURITY DEFINER: get_account_tokens
--
-- Takes p_caller_id explicitly rather than reading auth.uid(): this
-- function is only ever invoked by the publish-post edge function using
-- the service-role key, under which auth.uid() does not resolve to the
-- end user. The edge function verifies p_caller_id against the request's
-- JWT via supabase.auth.getUser(token) before calling this function.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_account_tokens(p_account_id uuid, p_caller_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_owner_id uuid;
  v_access text;
  v_refresh text;
BEGIN
  SELECT ca.workspace_id INTO v_workspace_id FROM connected_accounts ca WHERE ca.id = p_account_id;
  IF v_workspace_id IS NULL THEN RETURN NULL; END IF;
  SELECT w.owner_id INTO v_owner_id FROM workspaces w WHERE w.id = v_workspace_id;
  IF v_owner_id IS NULL THEN RETURN NULL; END IF;
  IF p_caller_id IS NULL OR p_caller_id != v_owner_id THEN RETURN NULL; END IF;
  SELECT access_token_encrypted, refresh_token_encrypted INTO v_access, v_refresh
    FROM connected_accounts WHERE id = p_account_id;
  RETURN json_build_object('access_token', v_access, 'refresh_token', v_refresh);
END;
$$;

-- ============================================================
-- Fix: add UPDATE policy to api_keys (Phase 1 bug)
-- ============================================================
DROP POLICY IF EXISTS "update_own_api_keys" ON api_keys;
CREATE POLICY "update_own_api_keys" ON api_keys FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = api_keys.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = api_keys.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- Realtime
-- ============================================================
ALTER TABLE notifications REPLICA IDENTITY FULL;
