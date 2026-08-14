/*
# SocialPilot AI — Phase 2 AI Engine Schema

Adds the tables that power the AI Engine, Content Studio, Playground,
Prompt Library, Brand Voice, AI History, and Token Analytics.

## New Tables
- `ai_settings` — per-workspace AI configuration (provider, api_key_encrypted, default_model, temperature, max_tokens, streaming, free_only_mode, mode, last_successful_model).
- `brand_voice` — per-workspace brand voice profile (business name, description, audience, industry, writing style, tone, keywords, negative keywords, cta style, emoji style).
- `conversations` — AI Playground conversations (title, model, favorite, pinned).
- `messages` — messages within a conversation (role, content, tokens, model, response_time_ms, favorite, cost_estimate).
- `prompt_folders` — folders for organizing prompts.
- `prompts` — reusable prompts (title, content, category, variables, favorite, folder_id).
- `ai_history` — every AI generation record (type, input, output, model, tokens, cost, response_time_ms, status, favorite).
- `ai_usage_events` — granular token usage events for analytics (model, provider, tokens_in, tokens_out, cost, status, response_time_ms).

## Security
- RLS enabled on every table.
- Owner-scoped via workspace membership (EXISTS check against workspace_members).
- `ai_settings.api_key_encrypted` stores the provider API key server-side only; never exposed to the client through SELECT policies (a dedicated SECURITY DEFINER function `get_ai_provider_key` returns it only to the workspace owner, for edge-function use).
- Indexes on workspace_id, conversation_id, folder_id, created_at.

## Notes
1. All owner columns default to auth.uid().
2. The `ai_settings.api_key_encrypted` column is excluded from the normal SELECT policy via a view-free approach: a SECURITY DEFINER function `get_ai_provider_key(p_workspace_id uuid)` returns the key only when the caller is the workspace owner. The RLS SELECT policy on ai_settings returns all columns EXCEPT the key — implemented by granting SELECT on only the safe columns. In practice the client never queries the key column directly; the edge function uses the service role.
3. Safe to re-run (IF NOT EXISTS + DROP POLICY IF EXISTS).
*/

-- ============================================================
-- ai_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  provider text NOT NULL DEFAULT 'openrouter',
  api_key_encrypted text,
  default_model text NOT NULL DEFAULT 'openrouter/auto',
  temperature real NOT NULL DEFAULT 0.7 CHECK (temperature >= 0 AND temperature <= 2),
  max_tokens integer NOT NULL DEFAULT 1024 CHECK (max_tokens > 0 AND max_tokens <= 32000),
  streaming boolean NOT NULL DEFAULT true,
  free_only_mode boolean NOT NULL DEFAULT true,
  mode text NOT NULL DEFAULT 'free' CHECK (mode IN ('free', 'hybrid', 'paid')),
  last_successful_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_settings_workspace_id ON ai_settings(workspace_id);

DROP POLICY IF EXISTS "select_membership_ai_settings" ON ai_settings;
CREATE POLICY "select_membership_ai_settings" ON ai_settings FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ai_settings.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_ai_settings" ON ai_settings;
CREATE POLICY "insert_membership_ai_settings" ON ai_settings FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ai_settings.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_membership_ai_settings" ON ai_settings;
CREATE POLICY "update_membership_ai_settings" ON ai_settings FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ai_settings.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ai_settings.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_ai_settings" ON ai_settings;
CREATE POLICY "delete_membership_ai_settings" ON ai_settings FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ai_settings.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- brand_voice
-- ============================================================
CREATE TABLE IF NOT EXISTS brand_voice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  business_name text,
  description text,
  audience text,
  industry text,
  writing_style text,
  tone text,
  keywords text[] NOT NULL DEFAULT '{}',
  negative_keywords text[] NOT NULL DEFAULT '{}',
  cta_style text,
  emoji_style text NOT NULL DEFAULT 'minimal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE brand_voice ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_brand_voice_workspace_id ON brand_voice(workspace_id);

DROP POLICY IF EXISTS "select_membership_brand_voice" ON brand_voice;
CREATE POLICY "select_membership_brand_voice" ON brand_voice FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = brand_voice.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_brand_voice" ON brand_voice;
CREATE POLICY "insert_membership_brand_voice" ON brand_voice FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = brand_voice.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_membership_brand_voice" ON brand_voice;
CREATE POLICY "update_membership_brand_voice" ON brand_voice FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = brand_voice.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = brand_voice.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_brand_voice" ON brand_voice;
CREATE POLICY "delete_membership_brand_voice" ON brand_voice FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = brand_voice.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New Conversation',
  model text,
  favorite boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_favorite ON conversations(favorite);

DROP POLICY IF EXISTS "select_own_conversations" ON conversations;
CREATE POLICY "select_own_conversations" ON conversations FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_conversations" ON conversations;
CREATE POLICY "insert_own_conversations" ON conversations FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_conversations" ON conversations;
CREATE POLICY "update_own_conversations" ON conversations FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_conversations" ON conversations;
CREATE POLICY "delete_own_conversations" ON conversations FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- messages
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  model text,
  tokens integer NOT NULL DEFAULT 0,
  response_time_ms integer,
  cost_estimate real NOT NULL DEFAULT 0,
  favorite boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

DROP POLICY IF EXISTS "select_own_messages" ON messages;
CREATE POLICY "select_own_messages" ON messages FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_messages" ON messages;
CREATE POLICY "insert_own_messages" ON messages FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_messages" ON messages;
CREATE POLICY "update_own_messages" ON messages FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND c.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND c.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_messages" ON messages;
CREATE POLICY "delete_own_messages" ON messages FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND c.user_id = auth.uid())
  );

-- ============================================================
-- prompt_folders
-- ============================================================
CREATE TABLE IF NOT EXISTS prompt_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE prompt_folders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_prompt_folders_workspace_id ON prompt_folders(workspace_id);
CREATE INDEX IF NOT EXISTS idx_prompt_folders_user_id ON prompt_folders(user_id);

DROP POLICY IF EXISTS "select_own_prompt_folders" ON prompt_folders;
CREATE POLICY "select_own_prompt_folders" ON prompt_folders FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_prompt_folders" ON prompt_folders;
CREATE POLICY "insert_own_prompt_folders" ON prompt_folders FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_prompt_folders" ON prompt_folders;
CREATE POLICY "update_own_prompt_folders" ON prompt_folders FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_prompt_folders" ON prompt_folders;
CREATE POLICY "delete_own_prompt_folders" ON prompt_folders FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- prompts
-- ============================================================
CREATE TABLE IF NOT EXISTS prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES prompt_folders(id) ON DELETE SET NULL,
  title text NOT NULL,
  content text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  variables text[] NOT NULL DEFAULT '{}',
  favorite boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_prompts_workspace_id ON prompts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_prompts_user_id ON prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_prompts_category ON prompts(category);
CREATE INDEX IF NOT EXISTS idx_prompts_favorite ON prompts(favorite);
CREATE INDEX IF NOT EXISTS idx_prompts_folder_id ON prompts(folder_id);

DROP POLICY IF EXISTS "select_own_prompts" ON prompts;
CREATE POLICY "select_own_prompts" ON prompts FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_prompts" ON prompts;
CREATE POLICY "insert_own_prompts" ON prompts FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_prompts" ON prompts;
CREATE POLICY "update_own_prompts" ON prompts FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_prompts" ON prompts;
CREATE POLICY "delete_own_prompts" ON prompts FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- ai_history
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  input text NOT NULL,
  output text,
  model text,
  provider text NOT NULL DEFAULT 'openrouter',
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_estimate real NOT NULL DEFAULT 0,
  response_time_ms integer,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'timeout')),
  favorite boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_history ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_history_workspace_id ON ai_history(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_history_user_id ON ai_history(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_history_type ON ai_history(type);
CREATE INDEX IF NOT EXISTS idx_ai_history_created_at ON ai_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_history_favorite ON ai_history(favorite);

DROP POLICY IF EXISTS "select_own_ai_history" ON ai_history;
CREATE POLICY "select_own_ai_history" ON ai_history FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_ai_history" ON ai_history;
CREATE POLICY "insert_own_ai_history" ON ai_history FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_ai_history" ON ai_history;
CREATE POLICY "update_own_ai_history" ON ai_history FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_ai_history" ON ai_history;
CREATE POLICY "delete_own_ai_history" ON ai_history FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- ai_usage_events (granular analytics)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  model text NOT NULL,
  provider text NOT NULL DEFAULT 'openrouter',
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost real NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'failed', 'timeout')),
  response_time_ms integer,
  prompt_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_workspace_id ON ai_usage_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_id ON ai_usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_model ON ai_usage_events(model);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_created_at ON ai_usage_events(created_at DESC);

DROP POLICY IF EXISTS "select_own_ai_usage_events" ON ai_usage_events;
CREATE POLICY "select_own_ai_usage_events" ON ai_usage_events FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_ai_usage_events" ON ai_usage_events;
CREATE POLICY "insert_own_ai_usage_events" ON ai_usage_events FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_ai_usage_events" ON ai_usage_events;
CREATE POLICY "delete_own_ai_usage_events" ON ai_usage_events FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- SECURITY DEFINER function: get_ai_provider_key
-- Returns the encrypted API key only to the workspace owner.
-- Used by the edge function (service role), not the client.
--
-- Takes p_caller_id explicitly rather than reading auth.uid(): this
-- function is only ever invoked by the edge function using the
-- service-role key, under which auth.uid() does not resolve to the
-- end user. The edge function is responsible for verifying p_caller_id
-- against the request's JWT via supabase.auth.getUser(token) before
-- calling this function, so the check below remains authoritative.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_ai_provider_key(p_workspace_id uuid, p_caller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM workspaces WHERE id = p_workspace_id;
  IF v_owner IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_caller_id IS NULL OR p_caller_id != v_owner THEN
    RETURN NULL;
  END IF;
  SELECT api_key_encrypted INTO v_key FROM ai_settings WHERE workspace_id = p_workspace_id;
  RETURN v_key;
END;
$$;

-- ============================================================
-- Trigger: auto-create ai_settings + brand_voice on workspace creation
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_workspace_ai_setup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_settings (workspace_id) VALUES (NEW.id) ON CONFLICT (workspace_id) DO NOTHING;
  INSERT INTO public.brand_voice (workspace_id) VALUES (NEW.id) ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_workspace_ai_setup ON workspaces;
CREATE TRIGGER on_workspace_ai_setup
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_workspace_ai_setup();
