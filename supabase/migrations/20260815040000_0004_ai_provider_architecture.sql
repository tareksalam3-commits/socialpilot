/*
# Universal AI Provider Architecture

Replaces the hardcoded OpenAI/gpt-4o integration with a provider-agnostic
registry: Super Admin adds providers by API key only, the system discovers
models, ranks them, and fails over automatically. Nothing here is readable
or writable by non-super-admins — enforced by RLS, not just hidden UI.

1. New Tables
- `platform_admins` — platform-wide Super Admin flag (separate from
  workspace-level owner/admin/member roles, which stay unchanged).
- `ai_providers` — one row per provider (openai, openrouter, huggingface,
  gemini, anthropic, xai, mistral, groq, deepseek, cerebras, together,
  fireworks, cohere). Holds config + health, never the API key itself.
- `ai_provider_secrets` — API keys only. No RLS policies at all: reachable
  only by the service role from inside edge functions.
- `ai_models` — the dynamic model registry populated by discovery, with
  capability flags, cost, and health/circuit-breaker state.
- `ai_routing_policy` — singleton row for the global routing policy.

2. Security
- `is_super_admin()` is SECURITY DEFINER so RLS policies and the frontend
  can both check admin status without being able to read `platform_admins`
  directly.
- All AI config/registry tables: authenticated users can only read/write
  when `is_super_admin()` is true. Everyone else gets zero rows, and a
  direct write attempt is rejected by Postgres itself (403 at the DB
  layer, independent of any UI or edge-function check).
- `ai_provider_secrets` has RLS enabled and *no policies* — identical
  pattern to the existing `system_settings` table.

3. Bootstrapping
- No one is a super admin by default. Grant the first one manually from
  the Supabase SQL editor (service role):
    insert into public.platform_admins (user_id) values ('<user-uuid>');
*/

-- ---------- platform_admins ----------
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id)
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role can read/write this table directly.

CREATE OR REPLACE FUNCTION public.is_super_admin(check_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = check_uid
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

-- ---------- ai_providers ----------
CREATE TABLE IF NOT EXISTS public.ai_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text UNIQUE NOT NULL CHECK (provider_key IN (
    'openai','openrouter','huggingface','gemini','anthropic','xai',
    'mistral','groq','deepseek','cerebras','together','fireworks','cohere'
  )),
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  has_api_key boolean NOT NULL DEFAULT false,
  base_url text,
  extra_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority int NOT NULL DEFAULT 100,
  failover_enabled boolean NOT NULL DEFAULT true,
  allow_paid boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured','connected','error')),
  last_test_at timestamptz,
  last_test_ok boolean,
  last_error text,
  models_count int NOT NULL DEFAULT 0,
  healthy_models_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aip_super_admin_all" ON public.ai_providers;
CREATE POLICY "aip_super_admin_all" ON public.ai_providers FOR ALL
  TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------- ai_provider_secrets (service role only, no policies) ----------
CREATE TABLE IF NOT EXISTS public.ai_provider_secrets (
  provider_key text PRIMARY KEY REFERENCES public.ai_providers(provider_key) ON DELETE CASCADE,
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_provider_secrets ENABLE ROW LEVEL SECURITY;
-- No policies: API keys are reachable only by the service role inside edge functions.

-- ---------- ai_models ----------
CREATE TABLE IF NOT EXISTS public.ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text NOT NULL REFERENCES public.ai_providers(provider_key) ON DELETE CASCADE,
  model_id text NOT NULL,
  display_name text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_window int,
  max_output_tokens int,
  vision boolean NOT NULL DEFAULT false,
  reasoning boolean NOT NULL DEFAULT false,
  tool_calling boolean NOT NULL DEFAULT false,
  structured_output boolean NOT NULL DEFAULT false,
  audio boolean NOT NULL DEFAULT false,
  image boolean NOT NULL DEFAULT false,
  embedding boolean NOT NULL DEFAULT false,
  is_free boolean NOT NULL DEFAULT false,
  input_cost_per_1k numeric,
  output_cost_per_1k numeric,
  quality_score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy','degraded','disabled')),
  circuit_state text NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','half_open')),
  circuit_opened_at timestamptz,
  success_count int NOT NULL DEFAULT 0,
  failure_count int NOT NULL DEFAULT 0,
  consecutive_failures int NOT NULL DEFAULT 0,
  avg_latency_ms int,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_key, model_id)
);
ALTER TABLE public.ai_models ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_ai_models_provider ON public.ai_models(provider_key);
CREATE INDEX IF NOT EXISTS idx_ai_models_status ON public.ai_models(status, circuit_state);

DROP POLICY IF EXISTS "aim_super_admin_all" ON public.ai_models;
CREATE POLICY "aim_super_admin_all" ON public.ai_models FOR ALL
  TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- ---------- ai_routing_policy (singleton) ----------
CREATE TABLE IF NOT EXISTS public.ai_routing_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  policy text NOT NULL DEFAULT 'smart_balanced' CHECK (policy IN ('smart_balanced','free_first','lowest_cost','best_quality','fastest')),
  allow_paid_fallback boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_routing_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arp_super_admin_all" ON public.ai_routing_policy;
CREATE POLICY "arp_super_admin_all" ON public.ai_routing_policy FOR ALL
  TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

INSERT INTO public.ai_routing_policy (id, policy, allow_paid_fallback)
VALUES (true, 'smart_balanced', true)
ON CONFLICT (id) DO NOTHING;

-- ---------- seed provider catalog (disabled, no keys yet) ----------
INSERT INTO public.ai_providers (provider_key, display_name, priority) VALUES
  ('openrouter',  'OpenRouter',    1),
  ('huggingface', 'Hugging Face',  2),
  ('groq',        'Groq',          3),
  ('gemini',      'Google Gemini', 4),
  ('cerebras',    'Cerebras',      5),
  ('deepseek',    'DeepSeek',      6),
  ('together',    'Together AI',   7),
  ('fireworks',   'Fireworks AI',  8),
  ('mistral',     'Mistral',       9),
  ('anthropic',   'Anthropic Claude', 10),
  ('xai',         'xAI Grok',      11),
  ('cohere',      'Cohere',        12),
  ('openai',      'OpenAI',        13)
ON CONFLICT (provider_key) DO NOTHING;

-- ---------- extend ai_runs for fallback observability ----------
ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS fallback_count int NOT NULL DEFAULT 0;
ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS fallback_log jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.ai_runs ADD COLUMN IF NOT EXISTS required_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ---------- updated_at triggers for the new tables ----------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['ai_providers','ai_models'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%I ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_touch_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();', t, t);
  END LOOP;
END $$;

-- ---------- migrate legacy system_settings AI keys off the old scheme ----------
DELETE FROM public.system_settings WHERE key IN ('ai.default_provider', 'ai.models');
INSERT INTO public.system_settings (key, value) VALUES
  ('ai.architecture_version', '"universal-provider-v1"'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
