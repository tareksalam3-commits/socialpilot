/*
# Inbox — Real Platform Sync + AI Auto-Reply (Part B)

Builds the infrastructure the Inbox was missing before any automation could
be trustworthy, then adds the automation layer on top of it.

## Phase 0 — real inbox
- `inbox_conversations.needs_review` — set when an inbound message trips an
  `excluded_keywords` guard; surfaced in `InboxPage.tsx` as a badge and
  excluded from further automation until a human clears it.
- `inbox_conversations.external_participant_id` — the platform-side id
  needed to actually send a reply (Messenger/Instagram PSID for DMs, or the
  commenter's id for comments). Separate from `external_id`, which continues
  to identify the thread itself (comment id / conversation id) and is now
  also used as the webhook upsert key.
- Unique index on (account_id, platform, type, external_id) so
  `inbox-webhook` can upsert idempotently — Meta redelivers webhooks on
  retry, and without this every redelivery would create a duplicate
  conversation.
- `inbox_conversations` added to the `supabase_realtime` publication (same
  pattern already used for `posts` and `notifications`) so `useInbox` can
  subscribe instead of polling.

## Phase 1 — automation
- `inbox_automation_rules` — one row per (workspace, optional account) auto-
  reply policy. RLS follows the same `workspace_members` membership pattern
  as every other workspace-scoped table (see `media_items`, `posts`).
*/

-- ============================================================
-- inbox_conversations — Phase 0 additions
-- ============================================================
ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS external_participant_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_conversations_webhook_upsert
  ON inbox_conversations (account_id, platform, type, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbox_conversations_needs_review ON inbox_conversations(needs_review);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'inbox_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox_conversations;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'inbox_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox_messages;
  END IF;
END $$;

-- ============================================================
-- inbox_automation_rules
-- ============================================================
CREATE TABLE IF NOT EXISTS inbox_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id uuid REFERENCES connected_accounts(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  scope text[] NOT NULL DEFAULT ARRAY['dm', 'comment']::text[],
  mode text NOT NULL DEFAULT 'draft_only' CHECK (mode IN ('auto_send', 'draft_only')),
  tone_override text,
  business_hours_only boolean NOT NULL DEFAULT false,
  excluded_keywords text[] NOT NULL DEFAULT '{}'::text[],
  max_auto_replies_per_day integer NOT NULL DEFAULT 20,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inbox_automation_rules ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_inbox_automation_rules_workspace_id ON inbox_automation_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inbox_automation_rules_account_id ON inbox_automation_rules(account_id);

DROP POLICY IF EXISTS "select_own_inbox_automation_rules" ON inbox_automation_rules;
CREATE POLICY "select_own_inbox_automation_rules" ON inbox_automation_rules FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_automation_rules.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_inbox_automation_rules" ON inbox_automation_rules;
CREATE POLICY "insert_own_inbox_automation_rules" ON inbox_automation_rules FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_automation_rules.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_inbox_automation_rules" ON inbox_automation_rules;
CREATE POLICY "update_own_inbox_automation_rules" ON inbox_automation_rules FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_automation_rules.workspace_id AND m.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_automation_rules.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_inbox_automation_rules" ON inbox_automation_rules;
CREATE POLICY "delete_own_inbox_automation_rules" ON inbox_automation_rules FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = inbox_automation_rules.workspace_id AND m.user_id = auth.uid())
  );

-- Service-role (inbox-webhook / automation engine) needs to read rules for
-- workspaces it is acting on behalf of without an end-user JWT — same
-- bypass shape as get_account_tokens's service_role branch, but simpler
-- here since rules aren't secret: a plain policy scoped to the service_role
-- grant is enough (service-role already bypasses RLS by default, this
-- policy is defense-in-depth documentation of that fact and a safety net
-- if RLS bypass is ever disabled for the function's client).
DROP POLICY IF EXISTS "service_role_all_inbox_automation_rules" ON inbox_automation_rules;
CREATE POLICY "service_role_all_inbox_automation_rules" ON inbox_automation_rules FOR ALL
  TO service_role USING (true) WITH CHECK (true);
