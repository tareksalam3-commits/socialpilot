/*
# Automatic workspace provisioning

- Every regular auth user receives one Workspace and owner membership atomically.
- Platform Super Admins remain workspace-less and are routed to the admin console.
- Existing regular users without a Workspace are repaired on first authenticated load
  by the client calling create_workspace_with_owner().
*/

CREATE OR REPLACE FUNCTION public.handle_new_user_workspace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A platform-level admin is intentionally not a Workspace member.
  -- Admin provisioning can set either metadata field before/with account creation.
  IF COALESCE(NEW.raw_app_meta_data ->> 'platform_role', '') = 'super_admin'
     OR COALESCE(NEW.raw_user_meta_data ->> 'platform_role', '') = 'super_admin' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.workspaces (name, owner_id)
  VALUES ('مساحتي', NEW.id);

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  SELECT w.id, NEW.id, 'owner'
  FROM public.workspaces AS w
  WHERE w.owner_id = NEW.id
  ORDER BY w.created_at DESC
  LIMIT 1
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_create_workspace ON auth.users;
CREATE TRIGGER on_auth_user_created_create_workspace
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_workspace();

REVOKE EXECUTE ON FUNCTION public.handle_new_user_workspace() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_workspace_with_owner(ws_name text DEFAULT 'مساحتي')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_ws_id uuid;
  owner_id uuid := auth.uid();
BEGIN
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = owner_id) THEN
    RETURN NULL;
  END IF;

  SELECT w.id INTO new_ws_id
  FROM public.workspaces AS w
  WHERE w.owner_id = owner_id
  ORDER BY w.created_at ASC
  LIMIT 1;

  IF new_ws_id IS NOT NULL THEN
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (new_ws_id, owner_id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
    RETURN new_ws_id;
  END IF;

  INSERT INTO public.workspaces (name, owner_id)
  VALUES (ws_name, owner_id)
  RETURNING id INTO new_ws_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_ws_id, owner_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN new_ws_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_workspace_with_owner(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_workspace_with_owner(text) TO authenticated;

-- Repair regular accounts created before automatic provisioning was enabled.
DO $$
DECLARE
  u record;
  ws_id uuid;
BEGIN
  FOR u IN
    SELECT au.id
    FROM auth.users AS au
    WHERE NOT EXISTS (
      SELECT 1 FROM public.platform_admins AS pa WHERE pa.user_id = au.id
    )
      AND NOT EXISTS (
        SELECT 1 FROM public.workspaces AS w WHERE w.owner_id = au.id
      )
  LOOP
    INSERT INTO public.workspaces (name, owner_id)
    VALUES ('مساحتي', u.id)
    RETURNING id INTO ws_id;

    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (ws_id, u.id, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING;
  END LOOP;
END;
$$;
