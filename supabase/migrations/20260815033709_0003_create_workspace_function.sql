/*
# Create atomic workspace + owner function

1. New Functions
- `create_workspace_with_owner(name text)` — SECURITY DEFINER function that atomically creates a workspace
  and its owner membership row. Returns the workspace UUID. Uses auth.uid() for the owner.

2. Why
- The frontend previously did two separate inserts (workspace + member), which is non-atomic.
- If the first succeeds and the second fails, the owner has a workspace but no membership row,
  breaking user_workspace_role() checks (including the owner themselves).
- This function guarantees both rows are created in a single transaction.

3. Security
- SECURITY DEFINER so it can insert into both tables regardless of RLS.
- SET search_path = public for safety.
- EXECUTE granted to authenticated only (not anon).
- Uses auth.uid() as the owner — cannot be spoofed by the caller.
*/

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
