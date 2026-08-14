-- SocialPilot — Production security and performance hardening
--
-- This migration applies least-privilege execution for public RPCs, closes the
-- mutable search-path findings, indexes foreign-key columns identified by the
-- production database advisor, and prevents repeated auth.uid() evaluation in
-- RLS policies. It is intentionally idempotent where PostgreSQL allows it.

-- 1) The only browser-invoked RPCs discovered in src/ are explicitly granted
-- to authenticated users. All other public-schema functions are internal to
-- triggers, pg_cron, or Edge Functions and must not be callable over PostgREST.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

GRANT EXECUTE ON FUNCTION public.get_scheduler_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_plan_info(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ai_provider_daily_usage() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_ai_provider_status() TO authenticated;

-- Edge Functions and scheduled jobs use the service role for server-side work.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 2) Trigger functions do not need the caller's mutable search path.
ALTER FUNCTION public.set_content_characteristics_updated_at() SET search_path = public;
ALTER FUNCTION public.set_content_recommendations_updated_at() SET search_path = public;

-- 3) Index foreign-key columns reported by the production performance advisor.
CREATE INDEX IF NOT EXISTS idx_activities_user_id ON public.activities (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_content_learnings_pattern_id ON public.content_learnings (pattern_id);
CREATE INDEX IF NOT EXISTS idx_content_recommendations_learning_id ON public.content_recommendations (learning_id);
CREATE INDEX IF NOT EXISTS idx_content_sources_user_id ON public.content_sources (user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_automation_rules_created_by ON public.inbox_automation_rules (created_by);
CREATE INDEX IF NOT EXISTS idx_inbox_conversations_assigned_to ON public.inbox_conversations (assigned_to);
CREATE INDEX IF NOT EXISTS idx_inbox_messages_user_id ON public.inbox_messages (user_id);
CREATE INDEX IF NOT EXISTS idx_media_folders_user_id ON public.media_folders (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_selections_user_id ON public.oauth_pending_selections (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_pending_selections_workspace_id ON public.oauth_pending_selections (workspace_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_user_id ON public.oauth_states (user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_workspace_id ON public.oauth_states (workspace_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON public.payments (subscription_id);
CREATE INDEX IF NOT EXISTS idx_platform_credentials_updated_by ON public.platform_credentials (updated_by);
CREATE INDEX IF NOT EXISTS idx_post_platform_targets_account_id ON public.post_platform_targets (account_id);
CREATE INDEX IF NOT EXISTS idx_publishing_logs_post_id ON public.publishing_logs (post_id);
CREATE INDEX IF NOT EXISTS idx_publishing_logs_target_id ON public.publishing_logs (target_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id ON public.subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_system_settings_updated_by ON public.system_settings (updated_by);
CREATE INDEX IF NOT EXISTS idx_workspace_invitations_invited_by ON public.workspace_invitations (invited_by);

-- 4) Supabase recommends wrapping auth.uid() in a SELECT so Postgres evaluates
-- it once per policy scan rather than once for every candidate row. Preserve
-- every existing policy expression and role; only replace this stable call.
DO $$
DECLARE
  p record;
  v_sql text;
BEGIN
  FOR p IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND roles = ARRAY['authenticated']::name[]
      AND (COALESCE(qual, '') LIKE '%auth.uid()%' OR COALESCE(with_check, '') LIKE '%auth.uid()%')
  LOOP
    v_sql := format('ALTER POLICY %I ON public.%I', p.policyname, p.tablename);

    IF p.qual IS NOT NULL THEN
      v_sql := v_sql || format(' USING (%s)', replace(p.qual, 'auth.uid()', '(select auth.uid())'));
    END IF;

    IF p.with_check IS NOT NULL THEN
      v_sql := v_sql || format(' WITH CHECK (%s)', replace(p.with_check, 'auth.uid()', '(select auth.uid())'));
    END IF;

    EXECUTE v_sql;
  END LOOP;
END;
$$;
