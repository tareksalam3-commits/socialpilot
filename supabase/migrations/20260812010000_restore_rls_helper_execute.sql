-- Restore the only RLS helper required by authenticated policies.
--
-- is_super_admin() is evaluated inside several public-table RLS policies.
-- The prior least-privilege migration correctly removed broad execution but
-- must retain this explicit grant; without it every affected page receives a
-- PostgreSQL "permission denied for function is_super_admin" error.
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
