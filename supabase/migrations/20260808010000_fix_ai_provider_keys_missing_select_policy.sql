/*
# Fix: ai_provider_keys UPDATE silently affected 0 rows for Super Admin

## Root cause
The table (see 20260807000000_globalize_ai_provider_config.sql) has
INSERT/UPDATE/DELETE policies gated on is_super_admin(), but deliberately
NO SELECT policy — the intent was "even Super Admin reads status only
through list_ai_provider_status(), never the raw row".

In practice, Postgres needs row visibility to evaluate the WHERE clause of
an UPDATE/DELETE. Without any SELECT policy, RLS defaults to deny for that
visibility check — so `UPDATE ai_provider_keys SET ... WHERE provider = 'x'`
silently matched 0 rows even when the UPDATE policy's own
USING(is_super_admin()) was true. No error was raised, so the app reported
"saved successfully" while nothing was actually written. Verified directly
against the live database (rows_updated: 0 before this fix, 1 after).

## Fix
Add a SELECT policy scoped to Super Admin. This does not expose the raw key
to the client: the `authenticated` role still has no column-level GRANT on
`api_key_encrypted` (see the original migration) — only on
provider/base_url/account_id/last_test_status/last_tested_at/updated_at/id
— so even this full-row SELECT policy can't leak the secret. Reading
configuration state for the UI continues to go through
list_ai_provider_status(), which explicitly withholds the key. Safe to
re-run.
*/

DROP POLICY IF EXISTS "super_admin_select_ai_provider_keys" ON ai_provider_keys;
CREATE POLICY "super_admin_select_ai_provider_keys" ON ai_provider_keys FOR SELECT
  TO authenticated USING (is_super_admin());
