/*
# Globalize AI provider keys & settings, retire the dead catalog

Converts ai_provider_keys and ai_settings from per-workspace tables into a
single platform-wide configuration, matching how the ai-gateway edge
function actually works (one shared pool of provider keys with dynamic
fallback between them, not one key per workspace).

## Changes
1. ai_provider_keys: drop workspace_id, enforce one row per provider
   (UNIQUE(provider)), seed the 6 real gateway providers. Still no SELECT
   policy for anyone via the table itself — status is read only through
   `list_ai_provider_status()`, which never returns the raw key.
2. ai_settings: collapse to a true singleton (boolean-PK trick), drop
   workspace_id and the unused legacy `api_key_encrypted` fallback column,
   add `model_selection` ('auto' | 'manual') and the missing
   `last_successful_provider` column the gateway already writes to.
3. Drop the dead per-workspace `get_ai_provider_key()` / `get_ai_provider_credentials()`
   functions (never called from any client) and rewrite
   `list_ai_provider_status()` as a no-arg, super-admin-only global status check.
4. `handle_workspace_ai_setup()` no longer seeds a per-workspace ai_settings
   row (nothing to seed — it's global now); still seeds brand_voice.
5. Drop the legacy `ai_providers` / `ai_models` catalog tables — dead,
   never wired to the gateway.
6. RLS: ai_settings readable by any authenticated user (regular AI features
   need default_model/temperature/max_tokens to make requests), writable
   only by super admins. ai_provider_keys writable only by super admins,
   selectable by no one directly.
*/

-- ============================================================
-- 1. ai_provider_keys → global, one row per provider
-- ============================================================
DROP POLICY IF EXISTS "delete_membership_ai_provider_keys" ON ai_provider_keys;
DROP POLICY IF EXISTS "delete_owner_ai_provider_keys" ON ai_provider_keys;
DROP POLICY IF EXISTS "insert_membership_ai_provider_keys" ON ai_provider_keys;
DROP POLICY IF EXISTS "insert_owner_ai_provider_keys" ON ai_provider_keys;
DROP POLICY IF EXISTS "select_membership_ai_provider_keys" ON ai_provider_keys;
DROP POLICY IF EXISTS "update_membership_ai_provider_keys" ON ai_provider_keys;
DROP POLICY IF EXISTS "update_owner_ai_provider_keys" ON ai_provider_keys;

ALTER TABLE ai_provider_keys DROP CONSTRAINT IF EXISTS ai_provider_keys_workspace_id_fkey;
ALTER TABLE ai_provider_keys DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE ai_provider_keys ADD CONSTRAINT ai_provider_keys_provider_key UNIQUE (provider);

-- No SELECT policy at all, on purpose: even super admins read status only
-- through list_ai_provider_status(), which withholds the encrypted key.
CREATE POLICY "super_admin_insert_ai_provider_keys" ON ai_provider_keys FOR INSERT
  TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "super_admin_update_ai_provider_keys" ON ai_provider_keys FOR UPDATE
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
CREATE POLICY "super_admin_delete_ai_provider_keys" ON ai_provider_keys FOR DELETE
  TO authenticated USING (is_super_admin());

INSERT INTO ai_provider_keys (provider)
VALUES ('openrouter'), ('groq'), ('cerebras'), ('nvidia'), ('mistral'), ('zai')
ON CONFLICT (provider) DO NOTHING;

-- ============================================================
-- 2. ai_settings → true singleton
-- ============================================================
DROP POLICY IF EXISTS "select_membership_ai_settings" ON ai_settings;
DROP POLICY IF EXISTS "insert_membership_ai_settings" ON ai_settings;
DROP POLICY IF EXISTS "update_membership_ai_settings" ON ai_settings;
DROP POLICY IF EXISTS "delete_membership_ai_settings" ON ai_settings;

ALTER TABLE ai_settings DROP CONSTRAINT IF EXISTS ai_settings_workspace_id_fkey;
ALTER TABLE ai_settings DROP CONSTRAINT IF EXISTS ai_settings_workspace_id_key;
DROP INDEX IF EXISTS idx_ai_settings_workspace_id;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS workspace_id;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS api_key_encrypted;
ALTER TABLE ai_settings DROP CONSTRAINT IF EXISTS ai_settings_pkey;
ALTER TABLE ai_settings DROP COLUMN IF EXISTS id;
ALTER TABLE ai_settings ADD COLUMN id boolean NOT NULL DEFAULT true;
ALTER TABLE ai_settings ADD CONSTRAINT ai_settings_pkey PRIMARY KEY (id);
ALTER TABLE ai_settings ADD CONSTRAINT ai_settings_singleton_check CHECK (id);

ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS model_selection text NOT NULL DEFAULT 'auto';
ALTER TABLE ai_settings DROP CONSTRAINT IF EXISTS ai_settings_model_selection_check;
ALTER TABLE ai_settings ADD CONSTRAINT ai_settings_model_selection_check
  CHECK (model_selection IN ('manual', 'auto'));
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS last_successful_provider text;

CREATE POLICY "select_authenticated_ai_settings" ON ai_settings FOR SELECT
  TO authenticated USING (true);
CREATE POLICY "super_admin_insert_ai_settings" ON ai_settings FOR INSERT
  TO authenticated WITH CHECK (is_super_admin());
CREATE POLICY "super_admin_update_ai_settings" ON ai_settings FOR UPDATE
  TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

INSERT INTO ai_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. Functions: drop the dead per-workspace key getters,
--    rewrite the status RPC as global + super-admin-gated
-- ============================================================
DROP FUNCTION IF EXISTS public.get_ai_provider_key(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.get_ai_provider_key(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_ai_provider_credentials(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.list_ai_provider_status(uuid, uuid);

CREATE OR REPLACE FUNCTION public.list_ai_provider_status()
RETURNS TABLE(provider text, configured boolean, base_url text, account_id text, last_test_status text, last_tested_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    k.provider,
    (k.api_key_encrypted IS NOT NULL AND k.api_key_encrypted <> '') AS configured,
    k.base_url,
    k.account_id,
    k.last_test_status,
    k.last_tested_at,
    k.updated_at
  FROM ai_provider_keys k;
END;
$$;

-- ============================================================
-- 4. Workspace-creation trigger no longer seeds ai_settings
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_workspace_ai_setup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.brand_voice (workspace_id) VALUES (NEW.id) ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- ============================================================
-- 5. Drop the dead per-workspace-unrelated catalog tables
-- ============================================================
DROP TABLE IF EXISTS ai_models;
DROP TABLE IF EXISTS ai_providers;
