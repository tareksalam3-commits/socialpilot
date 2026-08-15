/*
# Security hardening — fix advisor findings

1. Fix `touch_updated_at` mutable search path — add SET search_path.
2. Fix `user_workspace_role` — it needs to be callable by authenticated users (it's used in RLS policies),
   so we revoke EXECUTE from anon and keep it for authenticated. Add SET search_path.
3. `system_settings` having no policies is intentional (service-role only) — no change needed.
*/

-- Fix touch_updated_at search path
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Fix user_workspace_role: add search_path, revoke anon execute (only authenticated needs it for RLS)
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

REVOKE EXECUTE ON FUNCTION public.user_workspace_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.user_workspace_role(uuid) TO authenticated;
