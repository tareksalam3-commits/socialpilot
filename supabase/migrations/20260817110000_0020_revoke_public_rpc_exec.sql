-- Least-privilege hardening for scheduling RPCs.
-- These functions already use SECURITY INVOKER and workspace membership checks;
-- remove the unnecessary PUBLIC/anon execution grants while preserving the
-- authenticated client contract used by the application.

REVOKE EXECUTE ON FUNCTION public.approve_content_variant(uuid, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reschedule_calendar_item(uuid, uuid, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_content_variant(uuid, uuid, timestamptz) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.approve_content_variant(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_calendar_item(uuid, uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_content_variant(uuid, uuid, timestamptz) TO authenticated;
