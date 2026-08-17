-- Security-definer helpers used only by database triggers or internal policy paths
-- should not be exposed as authenticated RPC endpoints.
REVOKE EXECUTE ON FUNCTION public.handle_new_user_workspace() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_inbox_conversation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.am_i_platform_admin() FROM PUBLIC, anon, authenticated;

-- Keep the admin check as SECURITY DEFINER because platform_admins is intentionally
-- not user-readable, but prevent callers from probing another user's admin status.
CREATE OR REPLACE FUNCTION public.is_super_admin(check_uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT check_uid IS NOT NULL
     AND check_uid = auth.uid()
     AND EXISTS (
       SELECT 1 FROM public.platform_admins WHERE user_id = check_uid
     );
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
