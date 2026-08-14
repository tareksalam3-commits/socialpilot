/*
# Social Media Integrations — Hardening

## New Tables
- `platform_credentials` — stores the Meta/LinkedIn app credentials entered on
  Settings > Integrations (`meta_app_id`, `meta_app_secret`,
  `linkedin_client_id`, `linkedin_client_secret`, `app_url`). Referenced by
  `_shared/credentials.ts` and the `platform-credentials` edge function since
  Phase 3, but the table itself was never created — every OAuth connect
  attempt would fail. This migration adds it.

## Fixed
- `get_account_tokens(p_account_id, p_caller_id)` — previously returned NULL
  whenever `p_caller_id` was NULL, which is exactly how `run-scheduler` (cron,
  no end-user in the request) and retried targets call it. That made every
  scheduled publish and every automatic retry fail with "No access token for
  this account" despite the connected account being perfectly healthy. Fixed
  to also allow the call through when the JWT's role claim is `service_role`
  (i.e. the caller is an edge function using the service-role key, which by
  construction cannot be forged by a client) — real end-user calls still go
  through the original owner-match check.

## Security
- `platform_credentials` has RLS enabled with zero policies for
  `anon`/`authenticated`, matching the existing `app_secrets` pattern: only
  the service-role key (used exclusively inside edge functions) can read or
  write it. The client never queries this table directly — it goes through
  the `platform-credentials` edge function, which already withholds secret
  values from GET responses.
*/

-- ============================================================
-- platform_credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_credentials (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: RLS with no policies denies all client access.
-- Only the service-role key (edge functions) can read/write this table.

-- ============================================================
-- Fix: get_account_tokens must work for service-role/cron callers
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_account_tokens(p_account_id uuid, p_caller_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id uuid;
  v_owner_id uuid;
  v_access text;
  v_refresh text;
  v_is_service_role boolean;
BEGIN
  -- auth.role() reflects the role claim of the JWT PostgREST decoded for
  -- this request. A client cannot set this to 'service_role' themselves —
  -- it's only ever true when the caller authenticated with the actual
  -- service-role secret (i.e. an Anthropic/Supabase edge function such as
  -- run-scheduler or automation-control), which already sits behind its own
  -- auth checks before reaching here.
  v_is_service_role := auth.role() = 'service_role';

  SELECT ca.workspace_id INTO v_workspace_id FROM connected_accounts ca WHERE ca.id = p_account_id;
  IF v_workspace_id IS NULL THEN RETURN NULL; END IF;

  IF NOT v_is_service_role THEN
    SELECT w.owner_id INTO v_owner_id FROM workspaces w WHERE w.id = v_workspace_id;
    IF v_owner_id IS NULL THEN RETURN NULL; END IF;
    IF p_caller_id IS NULL OR p_caller_id != v_owner_id THEN RETURN NULL; END IF;
  END IF;

  SELECT access_token_encrypted, refresh_token_encrypted INTO v_access, v_refresh
    FROM connected_accounts WHERE id = p_account_id;
  RETURN json_build_object('access_token', v_access, 'refresh_token', v_refresh);
END;
$$;
