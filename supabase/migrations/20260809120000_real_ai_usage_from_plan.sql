/*
  # Wire ai_usage to the real subscription plan + real AI activity

  Problem: `ai_usage` rows were never created for a workspace (no default
  subscription either), and `credits_used` was never incremented by real
  AI activity (`ai_usage_events`). The dashboard therefore always fell back
  to a hardcoded 1000-credit limit with 0 used, regardless of the
  workspace's actual plan or actual usage.

  This migration:
  1. Auto-provisions a Free-plan subscription + ai_usage row for every new
     workspace (extends handle_new_workspace()).
  2. Keeps ai_usage.credits_limit in sync with the workspace's plan whenever
     the subscription is created or the plan changes.
  3. Increments ai_usage.credits_used from real ai_usage_events (successful
     AI calls only), rolling the period over monthly.
  4. Adds a SECURITY DEFINER RPC so any workspace member (not just the
     owner) can read their plan name/status for display, without loosening
     the subscriptions RLS policy.
  5. Backfills existing workspaces that predate this migration.

  Safe to re-run.
*/

-- ============================================================
-- 1) Provision subscription + ai_usage on workspace creation
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id uuid;
  v_plan_credits integer;
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  SELECT id, ai_credits_included INTO v_plan_id, v_plan_credits
  FROM public.subscription_plans
  WHERE slug = 'free'
  LIMIT 1;

  INSERT INTO public.subscriptions (workspace_id, plan_id, status, billing_cycle, current_period_start, current_period_end)
  VALUES (NEW.id, v_plan_id, 'active', 'monthly', now(), now() + interval '1 month')
  ON CONFLICT (workspace_id) DO NOTHING;

  INSERT INTO public.ai_usage (workspace_id, credits_used, credits_limit, period_start)
  VALUES (NEW.id, 0, COALESCE(v_plan_credits, 200), now())
  ON CONFLICT (workspace_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ============================================================
-- 2) Keep credits_limit synced to the workspace's actual plan
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_ai_usage_credits_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_credits integer;
BEGIN
  SELECT ai_credits_included INTO v_plan_credits
  FROM public.subscription_plans
  WHERE id = NEW.plan_id;

  UPDATE public.ai_usage
  SET credits_limit = COALESCE(v_plan_credits, credits_limit),
      updated_at = now()
  WHERE workspace_id = NEW.workspace_id;

  INSERT INTO public.ai_usage (workspace_id, credits_used, credits_limit, period_start)
  SELECT NEW.workspace_id, 0, COALESCE(v_plan_credits, 200), now()
  WHERE NOT EXISTS (SELECT 1 FROM public.ai_usage WHERE workspace_id = NEW.workspace_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_subscription_plan_change ON subscriptions;
CREATE TRIGGER on_subscription_plan_change
  AFTER INSERT OR UPDATE OF plan_id ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.sync_ai_usage_credits_limit();

-- ============================================================
-- 3) Real usage: increment credits_used from real ai_usage_events,
--    rolling the period over monthly.
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_ai_usage_on_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start timestamptz;
BEGIN
  IF NEW.status <> 'success' THEN
    RETURN NEW;
  END IF;

  SELECT period_start INTO v_period_start
  FROM public.ai_usage
  WHERE workspace_id = NEW.workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.ai_usage (workspace_id, credits_used, credits_limit, period_start)
    VALUES (NEW.workspace_id, 1, 200, now());
    RETURN NEW;
  END IF;

  IF now() >= v_period_start + interval '1 month' THEN
    UPDATE public.ai_usage
    SET credits_used = 1, period_start = now(), updated_at = now()
    WHERE workspace_id = NEW.workspace_id;
  ELSE
    UPDATE public.ai_usage
    SET credits_used = credits_used + 1, updated_at = now()
    WHERE workspace_id = NEW.workspace_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_ai_usage_event_increment ON ai_usage_events;
CREATE TRIGGER on_ai_usage_event_increment
  AFTER INSERT ON ai_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.increment_ai_usage_on_event();

-- ============================================================
-- 4) Let any workspace member read plan name/status (not just owner)
--    without loosening subscriptions RLS.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_workspace_plan_info(p_workspace_id uuid)
RETURNS TABLE (plan_name text, plan_slug text, status text, current_period_end timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_members m
    WHERE m.workspace_id = p_workspace_id AND m.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a member of this workspace';
  END IF;

  RETURN QUERY
  SELECT sp.name, sp.slug, s.status, s.current_period_end
  FROM public.subscriptions s
  JOIN public.subscription_plans sp ON sp.id = s.plan_id
  WHERE s.workspace_id = p_workspace_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_plan_info(uuid) TO authenticated;

-- ============================================================
-- 5) Backfill workspaces created before this migration
-- ============================================================
DO $$
DECLARE
  v_free_plan_id uuid;
  v_free_credits integer;
  r record;
BEGIN
  SELECT id, ai_credits_included INTO v_free_plan_id, v_free_credits
  FROM public.subscription_plans WHERE slug = 'free' LIMIT 1;

  FOR r IN SELECT id FROM public.workspaces LOOP
    -- Note: this insert fires on_subscription_plan_change, which itself
    -- creates a zero-usage ai_usage row if one doesn't exist yet — so the
    -- real-usage count below must be an UPDATE, not a conditional INSERT,
    -- or it will find the row "already exists" and skip setting real usage.
    INSERT INTO public.subscriptions (workspace_id, plan_id, status, billing_cycle, current_period_start, current_period_end)
    VALUES (r.id, v_free_plan_id, 'active', 'monthly', now(), now() + interval '1 month')
    ON CONFLICT (workspace_id) DO NOTHING;

    INSERT INTO public.ai_usage (workspace_id, credits_used, credits_limit, period_start)
    VALUES (r.id, 0, COALESCE(v_free_credits, 200), now())
    ON CONFLICT (workspace_id) DO NOTHING;

    UPDATE public.ai_usage au
    SET credits_used = sub.cnt, updated_at = now()
    FROM (
      SELECT count(*) AS cnt FROM public.ai_usage_events e
      WHERE e.workspace_id = r.id AND e.status = 'success' AND e.created_at >= now() - interval '1 month'
    ) sub
    WHERE au.workspace_id = r.id AND sub.cnt > au.credits_used;
  END LOOP;
END $$;
