/*
# OAuth Connect Flow — Meta & LinkedIn

## New Tables
- `oauth_states` — short-lived CSRF state for the OAuth redirect dance. Row is
  created right before we send the user to Facebook/LinkedIn and is deleted
  (or expires) once the callback consumes it. Prevents forged callbacks.
- `oauth_pending_selections` — after the callback exchanges the code for a
  token, we fetch the user's Pages / Instagram Business accounts / LinkedIn
  organizations and stash them here so the user can pick which ones to
  connect, instead of connecting everything automatically. Expires in 15 min.

## Security
- RLS scoped to auth.uid(). No client ever reads another user's state or
  pending selection.
- Both tables only ever hold short-lived data and are written by the
  service-role key from inside edge functions; policies below only cover the
  read path used by the frontend when resuming a selection.
*/

-- The OAuth finalize step upserts on (workspace_id, platform, provider_account_id)
-- so reconnecting the same Page/org doesn't create a duplicate row. This was
-- previously unconstrained since accounts were only ever added by hand one at a time.
ALTER TABLE connected_accounts
  ADD COLUMN IF NOT EXISTS provider_account_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_connected_accounts_workspace_platform_provider
  ON connected_accounts (workspace_id, platform, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text UNIQUE NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta', 'linkedin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);

DROP POLICY IF EXISTS "select_own_oauth_states" ON oauth_states;
CREATE POLICY "select_own_oauth_states" ON oauth_states FOR SELECT
  TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS oauth_pending_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta', 'linkedin')),
  options jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);

ALTER TABLE oauth_pending_selections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_oauth_pending_selections" ON oauth_pending_selections;
CREATE POLICY "select_own_oauth_pending_selections" ON oauth_pending_selections FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "delete_own_oauth_pending_selections" ON oauth_pending_selections;
CREATE POLICY "delete_own_oauth_pending_selections" ON oauth_pending_selections FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- Housekeeping: called opportunistically by the edge functions, and can also
-- be wired to a cron schedule (pg_cron) to sweep expired rows.
CREATE OR REPLACE FUNCTION public.cleanup_expired_oauth_rows()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM oauth_states WHERE expires_at < now();
  DELETE FROM oauth_pending_selections WHERE expires_at < now();
END;
$$;
