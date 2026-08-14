/*
# SocialPilot AI — Phase 1 Foundation Schema

Creates the core tables for a multi-tenant SaaS where each user owns one
workspace (Phase 1). The schema is designed to extend to multiple workspaces
per user later (the workspace_members table is the foundation for that).

## New Tables
- `workspaces` — a team/brand container (name, logo, brand_name, timezone, language, owner).
- `workspace_members` — membership rows linking auth.users to workspaces (role-based, ready for multi-workspace).
- `profiles` — per-user profile (avatar, full name, theme, language) keyed to auth.users.
- `connected_accounts` — placeholder rows for future social media connections (platform, handle, status).
- `scheduled_posts` — placeholder rows for future post scheduling (status, scheduled_for, content).
- `ai_usage` — single row per workspace tracking AI credit consumption (placeholder for future AI modules).
- `activity` — recent activity feed entries scoped to a workspace.
- `api_keys` — placeholder rows for future third-party API key storage (label, masked_value, status).

## Security
- RLS enabled on every table.
- Owner-scoped policies on workspaces (owner = auth.uid()).
- Membership-scoped policies on workspace_members, connected_accounts, scheduled_posts, ai_usage, activity, api_keys via EXISTS check against workspace_members.
- profiles scoped to the auth user themselves.
- Indexes on foreign keys and frequently-filtered columns (workspace_id, user_id, created_at).

## Notes
1. Owner columns default to auth.uid() so client inserts that omit the owner succeed.
2. workspace_members seeded implicitly: a trigger adds the owner as an 'owner' member whenever a workspace is created.
3. All timestamps default to now().
4. No destructive operations — safe to re-run (uses IF NOT EXISTS and DROP POLICY IF EXISTS).
*/

-- ============================================================
-- workspaces
-- ============================================================
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  brand_name text,
  timezone text NOT NULL DEFAULT 'UTC',
  language text NOT NULL DEFAULT 'en',
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON workspaces(owner_id);

DROP POLICY IF EXISTS "select_own_workspaces" ON workspaces;
CREATE POLICY "select_own_workspaces" ON workspaces FOR SELECT
  TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "insert_own_workspaces" ON workspaces;
CREATE POLICY "insert_own_workspaces" ON workspaces FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "update_own_workspaces" ON workspaces;
CREATE POLICY "update_own_workspaces" ON workspaces FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "delete_own_workspaces" ON workspaces;
CREATE POLICY "delete_own_workspaces" ON workspaces FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

-- ============================================================
-- workspace_members
-- ============================================================
CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id);

DROP POLICY IF EXISTS "select_membership_workspaces" ON workspace_members;
CREATE POLICY "select_membership_workspaces" ON workspace_members FOR SELECT
  TO authenticated USING (
    auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_workspaces" ON workspace_members;
CREATE POLICY "insert_membership_workspaces" ON workspace_members FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_membership_workspaces" ON workspace_members;
CREATE POLICY "update_membership_workspaces" ON workspace_members FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_workspaces" ON workspace_members;
CREATE POLICY "delete_membership_workspaces" ON workspace_members FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  avatar_url text,
  full_name text,
  theme text NOT NULL DEFAULT 'light',
  language text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON profiles(user_id);

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_profile" ON profiles;
CREATE POLICY "delete_own_profile" ON profiles FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- ============================================================
-- connected_accounts (future social media)
-- ============================================================
CREATE TABLE IF NOT EXISTS connected_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL,
  handle text,
  status text NOT NULL DEFAULT 'disconnected',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_connected_accounts_workspace_id ON connected_accounts(workspace_id);

DROP POLICY IF EXISTS "select_membership_connected_accounts" ON connected_accounts;
CREATE POLICY "select_membership_connected_accounts" ON connected_accounts FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = connected_accounts.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_connected_accounts" ON connected_accounts;
CREATE POLICY "insert_membership_connected_accounts" ON connected_accounts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = connected_accounts.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_membership_connected_accounts" ON connected_accounts;
CREATE POLICY "update_membership_connected_accounts" ON connected_accounts FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = connected_accounts.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = connected_accounts.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_connected_accounts" ON connected_accounts;
CREATE POLICY "delete_membership_connected_accounts" ON connected_accounts FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = connected_accounts.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- scheduled_posts (future scheduling)
-- ============================================================
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  content text,
  status text NOT NULL DEFAULT 'draft',
  scheduled_for timestamptz,
  platforms text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE scheduled_posts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_scheduled_posts_workspace_id ON scheduled_posts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status ON scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_scheduled_posts_scheduled_for ON scheduled_posts(scheduled_for);

DROP POLICY IF EXISTS "select_membership_scheduled_posts" ON scheduled_posts;
CREATE POLICY "select_membership_scheduled_posts" ON scheduled_posts FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = scheduled_posts.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_scheduled_posts" ON scheduled_posts;
CREATE POLICY "insert_membership_scheduled_posts" ON scheduled_posts FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = scheduled_posts.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_membership_scheduled_posts" ON scheduled_posts;
CREATE POLICY "update_membership_scheduled_posts" ON scheduled_posts FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = scheduled_posts.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = scheduled_posts.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_scheduled_posts" ON scheduled_posts;
CREATE POLICY "delete_membership_scheduled_posts" ON scheduled_posts FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = scheduled_posts.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- ai_usage (placeholder for future AI modules)
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  credits_used integer NOT NULL DEFAULT 0,
  credits_limit integer NOT NULL DEFAULT 1000,
  period_start timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_usage_workspace_id ON ai_usage(workspace_id);

DROP POLICY IF EXISTS "select_membership_ai_usage" ON ai_usage;
CREATE POLICY "select_membership_ai_usage" ON ai_usage FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ai_usage.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_ai_usage" ON ai_usage;
CREATE POLICY "insert_membership_ai_usage" ON ai_usage FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ai_usage.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_membership_ai_usage" ON ai_usage;
CREATE POLICY "update_membership_ai_usage" ON ai_usage FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ai_usage.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ai_usage.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_ai_usage" ON ai_usage;
CREATE POLICY "delete_membership_ai_usage" ON ai_usage FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ai_usage.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- activity (recent activity feed)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_activity_workspace_id ON activity(workspace_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at DESC);

DROP POLICY IF EXISTS "select_membership_activity" ON activity;
CREATE POLICY "select_membership_activity" ON activity FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = activity.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_activity" ON activity;
CREATE POLICY "insert_membership_activity" ON activity FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = activity.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_activity" ON activity;
CREATE POLICY "delete_membership_activity" ON activity FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = activity.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- api_keys (placeholder for future third-party integrations)
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label text NOT NULL,
  masked_value text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id ON api_keys(workspace_id);

DROP POLICY IF EXISTS "select_membership_api_keys" ON api_keys;
CREATE POLICY "select_membership_api_keys" ON api_keys FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = api_keys.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_api_keys" ON api_keys;
CREATE POLICY "insert_membership_api_keys" ON api_keys FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = api_keys.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_api_keys" ON api_keys;
CREATE POLICY "delete_membership_api_keys" ON api_keys FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = api_keys.workspace_id AND w.owner_id = auth.uid())
  );

-- ============================================================
-- Trigger: auto-create profile on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-add owner as a workspace_member when a workspace is created
CREATE OR REPLACE FUNCTION public.handle_new_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_workspace_created ON workspaces;
CREATE TRIGGER on_workspace_created
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_workspace();
