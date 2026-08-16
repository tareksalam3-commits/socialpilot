/*
# X (Twitter) Integration + Real Publishing Execution

هذا الملف بيعمل حاجتين:

1. بيقفل فجوة كانت موجودة في المايجريشنز: الجداول اللي بتستخدمها edge
   functions الخاصة بربط السوشيال (social-oauth-start/callback,
   social-telegram-connect, social-platform-admin) — زي
   social_platform_apps, social_platform_app_secrets, social_oauth_states,
   social_account_tokens — وكمان أعمدة زي social_accounts.external_id/
   page_id/ig_user_id — كانت متستخدمة في الكود بس مش متعرّفة في أي
   مايجريشن (كانت اتعملت يدويًا). النسخة دي بتنشئهم IF NOT EXISTS عشان أي
   بيئة جديدة (أو staging) تتبني من المايجريشنز لوحدها من غير ما تكسر.

2. بتفعّل تكامل إكس (X/Twitter): بتضيف صف social_platform_apps لمنصة
   'x' (الـ check constraint كانت بالفعل بتسمح بيها من مايجريشن 0007)،
   وبتضيف عمود code_verifier لجدول social_oauth_states عشان PKCE
   (إكس بتطلب PKCE إجباري على OAuth 2.0).

3. بتوسّع publishing_jobs بعمودين (platform, result) عشان الـ
   social-publish function الجديدة تقدر تسجّل نتيجة النشر الفعلي
   (معرف/رابط البوست) في قاعدة البيانات بدل ما تفضل بس queued.
*/

-- ---------- social_platform_apps ----------
-- إعدادات تطبيقات الربط (Meta / LinkedIn / Telegram / X...) — غير حساسة،
-- السر نفسه في جدول منفصل. الجدول ده متلمسش غير من خلال service role
-- جوه الـ edge functions، فمفيش داعي لأي policy تسمح لليوزر العادي.
CREATE TABLE IF NOT EXISTS public.social_platform_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_key text UNIQUE NOT NULL CHECK (platform_key IN ('meta', 'linkedin', 'telegram', 'x', 'tiktok', 'threads', 'whatsapp')),
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  has_secret boolean NOT NULL DEFAULT false,
  app_id text,
  redirect_uri text,
  scopes text,
  status text NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured', 'connected', 'error')),
  last_test_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_platform_apps ENABLE ROW LEVEL SECURITY;
-- No policies: reachable only via the service role inside edge functions
-- (social-platform-admin verifies is_super_admin() itself before touching it).

DO $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%I ON public.%I;', 'social_platform_apps', 'social_platform_apps');
  EXECUTE format('CREATE TRIGGER trg_touch_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();', 'social_platform_apps', 'social_platform_apps');
END $$;

-- ---------- social_platform_app_secrets (service role only, no policies) ----------
CREATE TABLE IF NOT EXISTS public.social_platform_app_secrets (
  platform_key text PRIMARY KEY REFERENCES public.social_platform_apps(platform_key) ON DELETE CASCADE,
  app_secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_platform_app_secrets ENABLE ROW LEVEL SECURITY;
-- No policies: app secrets / bot tokens are reachable only by the service role.

-- ---------- social_oauth_states ----------
-- صف CSRF-state قصير العمر بيربط بين social-oauth-start و
-- social-oauth-callback (اللي بيتنادى مباشرة من متصفح المستخدم من غير
-- Authorization header). code_verifier لازم لإكس لأنها بتطلب PKCE.
CREATE TABLE IF NOT EXISTS public.social_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text UNIQUE NOT NULL,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform_key text NOT NULL,
  code_verifier text,
  consumed boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_oauth_states ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_social_oauth_states_state ON public.social_oauth_states(state);
-- No policies: only the service role writes/reads this (start + callback).

-- Patch: add code_verifier to a pre-existing table from before this migration.
ALTER TABLE public.social_oauth_states ADD COLUMN IF NOT EXISTS code_verifier text;

-- ---------- social_account_tokens (service role only, no policies) ----------
-- صف واحد لكل حساب مربوط (account_id PK) عشان الـ upsert بدون onConflict
-- الموجود في social-oauth-callback يحدّث بدل ما يكرر الصفوف.
CREATE TABLE IF NOT EXISTS public.social_account_tokens (
  account_id uuid PRIMARY KEY REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text,
  token_type text,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.social_account_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: access tokens are reachable only by the service role
-- (social-oauth-callback writes them, social-publish reads them to post).

-- ---------- patch social_accounts: columns used by oauth-callback but never migrated ----------
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS page_id text;
ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS ig_user_id text;

-- ---------- seed X (Twitter) platform app ----------
INSERT INTO public.social_platform_apps (platform_key, display_name, scopes)
VALUES ('x', 'إكس (تويتر)', 'tweet.read tweet.write users.read offline.access')
ON CONFLICT (platform_key) DO NOTHING;

-- ---------- extend publishing_jobs so real publish results land in the DB ----------
ALTER TABLE public.publishing_jobs ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.publishing_jobs ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{}'::jsonb;
