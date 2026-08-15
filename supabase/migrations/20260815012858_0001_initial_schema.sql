/*
# SocialPilot AI — Initial Schema

Multi-tenant social media AI system. Each user owns workspaces; each workspace
has members, a brand brain, memory, social accounts, content, calendar, and AI runs.
Workspace isolation is enforced via RLS through a workspace_members join table.

1. New Tables
- `workspaces` — top-level tenant; owner is a user
- `workspace_members` — membership join (owner / admin / member roles)
- `brand_dna` — confirmed brand identity (one per workspace)
- `brand_memory` — living memory entries with confidence + evidence count
- `social_accounts` — connected platform accounts
- `content` — master content ideas + status
- `content_variants` — platform-specific variants of master content
- `quality_reviews` — quality engine results per variant
- `calendar_items` — scheduled slots referencing content/variants
- `publishing_jobs` — background publish/schedule jobs with retry + idempotency
- `ai_runs` — observability log for every AI operation
- `notifications` — in-app notifications
- `system_settings` — super-admin system-level config (locked to service role)
- `audit_logs` — security audit trail

2. Security
- RLS enabled on every table.
- Helper `user_workspace_role(ws_id)` returns the requesting user's role in a workspace (or NULL).
- Workspace-scoped tables allow CRUD only to members of that workspace.
- `system_settings` has no policies — only the service role (server) can read/write.
*/

-- ---------- workspaces ----------
CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'free',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

-- ---------- workspace_members ----------
CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- ---------- helper: membership role (after tables exist) ----------
CREATE OR REPLACE FUNCTION public.user_workspace_role(ws uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT role FROM public.workspace_members
  WHERE workspace_id = ws AND user_id = auth.uid()
  LIMIT 1
$$;

-- ---------- workspaces policies ----------
DROP POLICY IF EXISTS "ws_select_member" ON public.workspaces;
CREATE POLICY "ws_select_member" ON public.workspaces FOR SELECT
  TO authenticated USING (owner_id = auth.uid() OR public.user_workspace_role(id) IS NOT NULL);

DROP POLICY IF EXISTS "ws_insert_owner" ON public.workspaces;
CREATE POLICY "ws_insert_owner" ON public.workspaces FOR INSERT
  TO authenticated WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "ws_update_owner" ON public.workspaces;
CREATE POLICY "ws_update_owner" ON public.workspaces FOR UPDATE
  TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "ws_delete_owner" ON public.workspaces;
CREATE POLICY "ws_delete_owner" ON public.workspaces FOR DELETE
  TO authenticated USING (owner_id = auth.uid());

-- ---------- workspace_members policies ----------
DROP POLICY IF EXISTS "wm_select_member" ON public.workspace_members;
CREATE POLICY "wm_select_member" ON public.workspace_members FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);

DROP POLICY IF EXISTS "wm_insert_owner" ON public.workspace_members;
CREATE POLICY "wm_insert_owner" ON public.workspace_members FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IN ('owner','admin'));

DROP POLICY IF EXISTS "wm_update_owner" ON public.workspace_members;
CREATE POLICY "wm_update_owner" ON public.workspace_members FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'))
  WITH CHECK (public.user_workspace_role(workspace_id) IN ('owner','admin'));

DROP POLICY IF EXISTS "wm_delete_owner" ON public.workspace_members;
CREATE POLICY "wm_delete_owner" ON public.workspace_members FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

-- ---------- brand_dna ----------
CREATE TABLE IF NOT EXISTS public.brand_dna (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  basics jsonb NOT NULL DEFAULT '{}'::jsonb,
  identity jsonb NOT NULL DEFAULT '{}'::jsonb,
  tone jsonb NOT NULL DEFAULT '{}'::jsonb,
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  visual jsonb NOT NULL DEFAULT '{}'::jsonb,
  platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_dna ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bd_select_member" ON public.brand_dna;
CREATE POLICY "bd_select_member" ON public.brand_dna FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bd_insert_member" ON public.brand_dna;
CREATE POLICY "bd_insert_member" ON public.brand_dna FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bd_update_member" ON public.brand_dna;
CREATE POLICY "bd_update_member" ON public.brand_dna FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bd_delete_member" ON public.brand_dna;
CREATE POLICY "bd_delete_member" ON public.brand_dna FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

-- ---------- brand_memory ----------
CREATE TABLE IF NOT EXISTS public.brand_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('preference','performance','decision','rejection','approval','edit_pattern')),
  key text NOT NULL,
  value text NOT NULL,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_count int NOT NULL DEFAULT 1,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brand_memory ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_brand_memory_ws ON public.brand_memory(workspace_id);

DROP POLICY IF EXISTS "bmem_select_member" ON public.brand_memory;
CREATE POLICY "bmem_select_member" ON public.brand_memory FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bmem_insert_member" ON public.brand_memory;
CREATE POLICY "bmem_insert_member" ON public.brand_memory FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bmem_update_member" ON public.brand_memory;
CREATE POLICY "bmem_update_member" ON public.brand_memory FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bmem_delete_member" ON public.brand_memory;
CREATE POLICY "bmem_delete_member" ON public.brand_memory FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

-- ---------- social_accounts ----------
CREATE TABLE IF NOT EXISTS public.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('facebook','instagram','linkedin','x','threads','tiktok','telegram','whatsapp')),
  handle text,
  display_name text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected','disconnected','error','expired')),
  needs_reconnect boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, platform)
);
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_social_accounts_ws ON public.social_accounts(workspace_id);

DROP POLICY IF EXISTS "sa_select_member" ON public.social_accounts;
CREATE POLICY "sa_select_member" ON public.social_accounts FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "sa_insert_member" ON public.social_accounts;
CREATE POLICY "sa_insert_member" ON public.social_accounts FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "sa_update_member" ON public.social_accounts;
CREATE POLICY "sa_update_member" ON public.social_accounts FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "sa_delete_member" ON public.social_accounts;
CREATE POLICY "sa_delete_member" ON public.social_accounts FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

-- ---------- content ----------
CREATE TABLE IF NOT EXISTS public.content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  goal text,
  topic text,
  audience text,
  master_text text,
  status text NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','draft','review','approved','scheduled','published','rejected')),
  platforms jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_content_ws_status ON public.content(workspace_id, status);

DROP POLICY IF EXISTS "ct_select_member" ON public.content;
CREATE POLICY "ct_select_member" ON public.content FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ct_insert_member" ON public.content;
CREATE POLICY "ct_insert_member" ON public.content FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ct_update_member" ON public.content;
CREATE POLICY "ct_update_member" ON public.content FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ct_delete_member" ON public.content;
CREATE POLICY "ct_delete_member" ON public.content FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);

-- ---------- content_variants ----------
CREATE TABLE IF NOT EXISTS public.content_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES public.content(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL,
  text text NOT NULL,
  hashtags text[] NOT NULL DEFAULT '{}',
  cta text,
  media_brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content_variants ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_variants_content ON public.content_variants(content_id);

DROP POLICY IF EXISTS "cv_select_member" ON public.content_variants;
CREATE POLICY "cv_select_member" ON public.content_variants FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "cv_insert_member" ON public.content_variants;
CREATE POLICY "cv_insert_member" ON public.content_variants FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "cv_update_member" ON public.content_variants;
CREATE POLICY "cv_update_member" ON public.content_variants FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "cv_delete_member" ON public.content_variants;
CREATE POLICY "cv_delete_member" ON public.content_variants FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);

-- ---------- quality_reviews ----------
CREATE TABLE IF NOT EXISTS public.quality_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.content_variants(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('pass','review','fail')),
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  fixes_applied int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quality_reviews ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_qr_variant ON public.quality_reviews(variant_id);

DROP POLICY IF EXISTS "qr_select_member" ON public.quality_reviews;
CREATE POLICY "qr_select_member" ON public.quality_reviews FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "qr_insert_member" ON public.quality_reviews;
CREATE POLICY "qr_insert_member" ON public.quality_reviews FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "qr_update_member" ON public.quality_reviews;
CREATE POLICY "qr_update_member" ON public.quality_reviews FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "qr_delete_member" ON public.quality_reviews;
CREATE POLICY "qr_delete_member" ON public.quality_reviews FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

-- ---------- calendar_items ----------
CREATE TABLE IF NOT EXISTS public.calendar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_id uuid REFERENCES public.content(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.content_variants(id) ON DELETE CASCADE,
  platform text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','scheduled','publishing','published','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.calendar_items ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cal_ws_time ON public.calendar_items(workspace_id, scheduled_for);

DROP POLICY IF EXISTS "ci_select_member" ON public.calendar_items;
CREATE POLICY "ci_select_member" ON public.calendar_items FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ci_insert_member" ON public.calendar_items;
CREATE POLICY "ci_insert_member" ON public.calendar_items FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ci_update_member" ON public.calendar_items;
CREATE POLICY "ci_update_member" ON public.calendar_items FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ci_delete_member" ON public.calendar_items;
CREATE POLICY "ci_delete_member" ON public.calendar_items FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);

-- ---------- publishing_jobs ----------
CREATE TABLE IF NOT EXISTS public.publishing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.content_variants(id) ON DELETE CASCADE,
  calendar_item_id uuid REFERENCES public.calendar_items(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('publish','schedule','retry')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text,
  scheduled_for timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.publishing_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_pub_ws_status ON public.publishing_jobs(workspace_id, status);

DROP POLICY IF EXISTS "pj_select_member" ON public.publishing_jobs;
CREATE POLICY "pj_select_member" ON public.publishing_jobs FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "pj_insert_member" ON public.publishing_jobs;
CREATE POLICY "pj_insert_member" ON public.publishing_jobs FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "pj_update_member" ON public.publishing_jobs;
CREATE POLICY "pj_update_member" ON public.publishing_jobs FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "pj_delete_member" ON public.publishing_jobs;
CREATE POLICY "pj_delete_member" ON public.publishing_jobs FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

-- ---------- ai_runs ----------
CREATE TABLE IF NOT EXISTS public.ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  task text NOT NULL,
  intent text,
  agents jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  provider text,
  input_tokens int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  latency_ms int,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_airuns_ws ON public.ai_runs(workspace_id, created_at);

DROP POLICY IF EXISTS "ar_select_member" ON public.ai_runs;
CREATE POLICY "ar_select_member" ON public.ai_runs FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ar_insert_member" ON public.ai_runs;
CREATE POLICY "ar_insert_member" ON public.ai_runs FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ar_update_member" ON public.ai_runs;
CREATE POLICY "ar_update_member" ON public.ai_runs FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "ar_delete_member" ON public.ai_runs;
CREATE POLICY "ar_delete_member" ON public.ai_runs FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

-- ---------- notifications ----------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_notif_ws ON public.notifications(workspace_id, read);

DROP POLICY IF EXISTS "nt_select_member" ON public.notifications;
CREATE POLICY "nt_select_member" ON public.notifications FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "nt_insert_member" ON public.notifications;
CREATE POLICY "nt_insert_member" ON public.notifications FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "nt_update_member" ON public.notifications;
CREATE POLICY "nt_update_member" ON public.notifications FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "nt_delete_member" ON public.notifications;
CREATE POLICY "nt_delete_member" ON public.notifications FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);

-- ---------- system_settings (super-admin, service-role only) ----------
CREATE TABLE IF NOT EXISTS public.system_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
-- No policies: locked to service role.

-- ---------- audit_logs ----------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_ws ON public.audit_logs(workspace_id, created_at);

DROP POLICY IF EXISTS "al_select_member" ON public.audit_logs;
CREATE POLICY "al_select_member" ON public.audit_logs FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);

-- ---------- updated_at triggers ----------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['workspaces','brand_dna','brand_memory','social_accounts','content','content_variants'])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%I ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_touch_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();', t, t);
  END LOOP;
END $$;

-- ---------- default system settings ----------
INSERT INTO public.system_settings (key, value) VALUES
  ('ai.default_provider', '"openai"'::jsonb),
  ('ai.models', '{"fast":"gpt-4o-mini","default":"gpt-4o","strong":"gpt-4o"}'::jsonb),
  ('quality.thresholds', '{"pass":80,"review":60}'::jsonb),
  ('publishing.require_approval', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
