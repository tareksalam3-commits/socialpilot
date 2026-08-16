CREATE OR REPLACE FUNCTION public.schedule_content_variant(
  p_workspace_id uuid,
  p_variant_id uuid,
  p_scheduled_for timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_variant public.content_variants;
  v_calendar public.calendar_items;
BEGIN
  IF public.user_workspace_role(p_workspace_id) IS NULL THEN
    RAISE EXCEPTION 'workspace_access_denied';
  END IF;

  IF p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'scheduled_for_required';
  END IF;

  SELECT * INTO v_variant
  FROM public.content_variants
  WHERE id = p_variant_id AND workspace_id = p_workspace_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'variant_not_found';
  END IF;

  INSERT INTO public.calendar_items (
    workspace_id, content_id, variant_id, platform, scheduled_for, status
  )
  VALUES (
    p_workspace_id, v_variant.content_id, v_variant.id, v_variant.platform,
    p_scheduled_for, 'planned'
  )
  ON CONFLICT (workspace_id, variant_id) DO UPDATE
    SET scheduled_for = EXCLUDED.scheduled_for,
        status = 'planned'
  RETURNING * INTO v_calendar;

  UPDATE public.content_variants
  SET scheduled_at = p_scheduled_for
  WHERE id = v_variant.id AND workspace_id = p_workspace_id;

  UPDATE public.content
  SET scheduled_at = p_scheduled_for, status = 'scheduled'
  WHERE id = v_variant.content_id AND workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'calendar_item_id', v_calendar.id,
    'variant_id', v_variant.id,
    'scheduled_for', v_calendar.scheduled_for
  );
END;
$$;
