CREATE OR REPLACE FUNCTION public.reschedule_calendar_item(
  p_workspace_id uuid,
  p_calendar_item_id uuid,
  p_scheduled_for timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item public.calendar_items;
  v_job_count integer;
BEGIN
  IF public.user_workspace_role(p_workspace_id) IS NULL THEN
    RAISE EXCEPTION 'workspace_access_denied';
  END IF;
  IF p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'scheduled_for_required';
  END IF;

  SELECT * INTO v_item
  FROM public.calendar_items
  WHERE id = p_calendar_item_id AND workspace_id = p_workspace_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_item_not_found';
  END IF;
  IF v_item.status IN ('published','publishing','cancelled') THEN
    RAISE EXCEPTION 'calendar_item_not_reschedulable';
  END IF;

  UPDATE public.calendar_items
  SET scheduled_for = p_scheduled_for, status = 'scheduled'
  WHERE id = v_item.id;

  IF v_item.content_id IS NOT NULL THEN
    UPDATE public.content
    SET scheduled_at = p_scheduled_for, status = 'scheduled'
    WHERE id = v_item.content_id AND workspace_id = p_workspace_id;
  END IF;
  IF v_item.variant_id IS NOT NULL THEN
    UPDATE public.content_variants
    SET scheduled_at = p_scheduled_for
    WHERE id = v_item.variant_id AND workspace_id = p_workspace_id;
  END IF;

  UPDATE public.publishing_jobs
  SET scheduled_for = p_scheduled_for,
      action = CASE WHEN action = 'publish' THEN action ELSE 'schedule' END,
      status = CASE WHEN status = 'failed' THEN 'queued' ELSE status END,
      last_error = CASE WHEN status = 'failed' THEN NULL ELSE last_error END
  WHERE calendar_item_id = v_item.id
    AND workspace_id = p_workspace_id
    AND status NOT IN ('succeeded','cancelled');
  GET DIAGNOSTICS v_job_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'calendar_item_id', v_item.id,
    'scheduled_for', p_scheduled_for,
    'publishing_jobs_updated', v_job_count
  );
END;
$$;
