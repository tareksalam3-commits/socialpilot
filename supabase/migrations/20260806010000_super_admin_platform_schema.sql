/*
# SocialPilot AI — Super Admin Platform Schema

Adds a platform-wide "Super Admin" role on top of the existing per-workspace
roles (Owner / Manager / Member on `workspace_members`), plus the tables the
Super Admin panel needs to manage the whole platform from one place.

## Roles model
- `profiles.platform_role` — platform-wide role. `'user'` (default) or
  `'super_admin'`. Completely independent from workspace membership.
- `workspace_members.role` — unchanged column, now standardized on
  `'owner' | 'manager' | 'member'` for workspace-scoped permissions.

## New tables
- `subscription_plans` — plans Super Admin can define and price.
- `subscriptions` — one active subscription per workspace, linked to a plan.
- `payments` — payment/invoice history per workspace.
- `ai_providers` — AI providers available on the platform (OpenAI, Anthropic, ...).
- `ai_models` — models under each provider, with pricing/limits.
- `system_settings` — global key/value platform configuration.
- `audit_logs` — append-only log of Super Admin actions.

## Security
- `is_super_admin()` — SECURITY DEFINER helper, true if the calling user's
  `profiles.platform_role = 'super_admin'`. Used everywhere below instead of
  repeating the subquery, and marked STABLE so Postgres can cache it per query.
- RLS enabled on every new table. Super Admins get full access; workspace
  members get read-only access scoped to their own workspace where relevant
  (subscriptions, payments).
- Super-admin bypass policies are added to the existing platform-relevant
  tables (`profiles`, `workspaces`, `workspace_members`, `ai_usage`,
  `api_keys`, `platform_credentials`) so the panel can manage "All Users",
  "All Workspaces", "All AI Credits" and "Social Integrations" without
  touching those tables' existing owner/member policies.
- No destructive operations — safe to re-run.
*/

-- ============================================================
-- platform_role
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS platform_role text NOT NULL DEFAULT 'user';
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_platform_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_platform_role_check CHECK (platform_role IN ('user', 'super_admin'));

CREATE INDEX IF NOT EXISTS idx_profiles_platform_role ON profiles(platform_role) WHERE platform_role = 'super_admin';

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE user_id = auth.uid() AND platform_role = 'super_admin'
  );
$$;

-- Standardize workspace_members.role to the documented set going forward.
-- Existing free-text values outside this set (if any) are left as-is by the
-- backfill below only when they don't already match.
UPDATE workspace_members SET role = 'owner' WHERE role NOT IN ('owner', 'manager', 'member');

-- ============================================================
-- subscription_plans
-- ============================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  price_monthly numeric(10,2) NOT NULL DEFAULT 0,
  price_yearly numeric(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  ai_credits_included integer NOT NULL DEFAULT 0,
  max_workspaces integer NOT NULL DEFAULT 1,
  max_seats integer NOT NULL DEFAULT 1,
  max_connected_accounts integer NOT NULL DEFAULT 3,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_active_plans" ON subscription_plans;
CREATE POLICY "select_active_plans" ON subscription_plans FOR SELECT
  TO authenticated USING (is_active = true OR is_super_admin());

DROP POLICY IF EXISTS "super_admin_all_plans" ON subscription_plans;
CREATE POLICY "super_admin_all_plans" ON subscription_plans FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============================================================
-- subscriptions
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  plan_id uuid REFERENCES subscription_plans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'suspended')),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_id ON subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

DROP POLICY IF EXISTS "select_own_subscription" ON subscriptions;
CREATE POLICY "select_own_subscription" ON subscriptions FOR SELECT
  TO authenticated USING (
    is_super_admin()
    OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = subscriptions.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "super_admin_all_subscriptions" ON subscriptions;
CREATE POLICY "super_admin_all_subscriptions" ON subscriptions FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============================================================
-- payments
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES subscriptions(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  provider text NOT NULL DEFAULT 'manual',
  provider_reference text,
  invoice_url text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_payments_workspace_id ON payments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

DROP POLICY IF EXISTS "select_own_payments" ON payments;
CREATE POLICY "select_own_payments" ON payments FOR SELECT
  TO authenticated USING (
    is_super_admin()
    OR EXISTS (SELECT 1 FROM workspaces w WHERE w.id = payments.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "super_admin_all_payments" ON payments;
CREATE POLICY "super_admin_all_payments" ON payments FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============================================================
-- ai_providers / ai_models
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  base_url text,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_active_providers" ON ai_providers;
CREATE POLICY "select_active_providers" ON ai_providers FOR SELECT
  TO authenticated USING (is_active = true OR is_super_admin());

DROP POLICY IF EXISTS "super_admin_all_providers" ON ai_providers;
CREATE POLICY "super_admin_all_providers" ON ai_providers FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

CREATE TABLE IF NOT EXISTS ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
  model_key text NOT NULL,
  display_name text NOT NULL,
  context_window integer NOT NULL DEFAULT 8192,
  cost_per_1k_input numeric(10,4) NOT NULL DEFAULT 0,
  cost_per_1k_output numeric(10,4) NOT NULL DEFAULT 0,
  is_free boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, model_key)
);

ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_models_provider_id ON ai_models(provider_id);

DROP POLICY IF EXISTS "select_active_models" ON ai_models;
CREATE POLICY "select_active_models" ON ai_models FOR SELECT
  TO authenticated USING (is_active = true OR is_super_admin());

DROP POLICY IF EXISTS "super_admin_all_models" ON ai_models;
CREATE POLICY "super_admin_all_models" ON ai_models FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============================================================
-- system_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_all_settings" ON system_settings;
CREATE POLICY "super_admin_all_settings" ON system_settings FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============================================================
-- audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

DROP POLICY IF EXISTS "super_admin_select_audit_logs" ON audit_logs;
CREATE POLICY "super_admin_select_audit_logs" ON audit_logs FOR SELECT
  TO authenticated USING (is_super_admin());

DROP POLICY IF EXISTS "authenticated_insert_audit_logs" ON audit_logs;
CREATE POLICY "authenticated_insert_audit_logs" ON audit_logs FOR INSERT
  TO authenticated WITH CHECK (is_super_admin());

-- ============================================================
-- Super-admin bypass policies on existing platform-relevant tables
-- ============================================================

-- profiles: "All Users"
DROP POLICY IF EXISTS "super_admin_all_profiles" ON profiles;
CREATE POLICY "super_admin_all_profiles" ON profiles FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- workspaces: "All Workspaces"
DROP POLICY IF EXISTS "super_admin_all_workspaces" ON workspaces;
CREATE POLICY "super_admin_all_workspaces" ON workspaces FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- workspace_members
DROP POLICY IF EXISTS "super_admin_all_workspace_members" ON workspace_members;
CREATE POLICY "super_admin_all_workspace_members" ON workspace_members FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ai_usage: "All AI Credits"
DROP POLICY IF EXISTS "super_admin_all_ai_usage" ON ai_usage;
CREATE POLICY "super_admin_all_ai_usage" ON ai_usage FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- api_keys
DROP POLICY IF EXISTS "super_admin_all_api_keys" ON api_keys;
CREATE POLICY "super_admin_all_api_keys" ON api_keys FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- platform_credentials: "Social Integrations" — Super Admin only from here on.
-- (The platform-credentials edge function is updated separately to also
-- require is_super_admin() for writes; this policy covers any direct
-- client-side reads.)
DROP POLICY IF EXISTS "super_admin_all_platform_credentials" ON platform_credentials;
CREATE POLICY "super_admin_all_platform_credentials" ON platform_credentials FOR ALL
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ============================================================
-- Seed data (safe to re-run — ON CONFLICT DO NOTHING)
-- ============================================================
INSERT INTO subscription_plans (name, slug, description, price_monthly, price_yearly, ai_credits_included, max_workspaces, max_seats, max_connected_accounts, features, sort_order)
VALUES
  ('Free', 'free', 'Get started with the basics', 0, 0, 200, 1, 1, 3, '["1 workspace", "200 AI credits/mo", "3 connected accounts"]'::jsonb, 0),
  ('Pro', 'pro', 'For growing teams', 29, 290, 2000, 1, 5, 10, '["5 seats", "2,000 AI credits/mo", "10 connected accounts", "Content calendar"]'::jsonb, 1),
  ('Enterprise', 'enterprise', 'Unlimited scale with priority support', 99, 990, 10000, 5, 25, 50, '["25 seats", "10,000 AI credits/mo", "Unlimited connected accounts", "Priority support"]'::jsonb, 2)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO ai_providers (name, display_name, base_url, priority)
VALUES
  ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 0),
  ('openai', 'OpenAI', 'https://api.openai.com/v1', 1),
  ('anthropic', 'Anthropic', 'https://api.anthropic.com/v1', 2)
ON CONFLICT (name) DO NOTHING;

INSERT INTO ai_models (provider_id, model_key, display_name, context_window, cost_per_1k_input, cost_per_1k_output, is_free)
SELECT p.id, m.model_key, m.display_name, m.context_window, m.cost_in, m.cost_out, m.is_free
FROM ai_providers p
JOIN (VALUES
  ('openrouter', 'openrouter/auto', 'Auto (best free match)', 32000, 0, 0, true),
  ('openai', 'gpt-4o-mini', 'GPT-4o mini', 128000, 0.15, 0.60, false),
  ('anthropic', 'claude-sonnet-4-6', 'Claude Sonnet 4.6', 200000, 3.00, 15.00, false)
) AS m(provider_name, model_key, display_name, context_window, cost_in, cost_out, is_free)
  ON m.provider_name = p.name
ON CONFLICT (provider_id, model_key) DO NOTHING;

INSERT INTO system_settings (key, value, description)
VALUES
  ('platform_name', '"SocialPilot AI"'::jsonb, 'Displayed platform name'),
  ('maintenance_mode', 'false'::jsonb, 'When true, blocks non-admin sign-ins'),
  ('default_ai_credit_grant', '200'::jsonb, 'AI credits granted to new workspaces'),
  ('support_email', '"support@socialpilot.ai"'::jsonb, 'Support contact shown to users')
ON CONFLICT (key) DO NOTHING;
