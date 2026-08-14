-- Social inbound sync foundation
-- Keeps the existing Inbox/analytics architecture, but makes source identity
-- explicit so polling and webhooks are idempotent and correctly mapped.

ALTER TABLE inbox_conversations
  ADD COLUMN IF NOT EXISTS post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_participant_id text;

ALTER TABLE inbox_messages
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS sender_external_id text,
  ADD COLUMN IF NOT EXISTS sender_name text;

-- Collapse any legacy duplicate conversations before enforcing source identity.
-- Messages are moved to the oldest conversation so no history is discarded.
DO $$
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _inbox_conversation_dedupe (
    duplicate_id uuid PRIMARY KEY,
    canonical_id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _inbox_conversation_dedupe (duplicate_id, canonical_id)
  SELECT c.id,
         FIRST_VALUE(c.id) OVER (
           PARTITION BY c.account_id, c.platform, c.type, c.external_id
           ORDER BY c.created_at NULLS LAST, c.id
         )
  FROM inbox_conversations c
  WHERE c.external_id IS NOT NULL;

  DELETE FROM _inbox_conversation_dedupe WHERE duplicate_id = canonical_id;

  UPDATE inbox_messages m
  SET conversation_id = d.canonical_id
  FROM _inbox_conversation_dedupe d
  WHERE m.conversation_id = d.duplicate_id;

  DELETE FROM inbox_conversations c
  USING _inbox_conversation_dedupe d
  WHERE c.id = d.duplicate_id;
END $$;

-- Use a full unique index rather than a partial one: the sync path uses
-- ON CONFLICT (account_id, platform, type, external_id), and PostgreSQL can
-- infer this target reliably from a full unique index. NULL external_id values
-- remain non-conflicting under PostgreSQL's normal NULL uniqueness semantics.
DROP INDEX IF EXISTS uq_inbox_conversations_source;
CREATE UNIQUE INDEX uq_inbox_conversations_source
  ON inbox_conversations(account_id, platform, type, external_id);

CREATE INDEX IF NOT EXISTS idx_inbox_conversations_account_platform
  ON inbox_conversations(account_id, platform, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_conversations_post_id
  ON inbox_conversations(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inbox_messages_external_id
  ON inbox_messages(external_id) WHERE external_id IS NOT NULL;

-- Keep the oldest copy if a legacy webhook/polling race already produced
-- duplicate source messages inside the canonical conversation.
DELETE FROM inbox_messages m
USING (
  SELECT id,
         FIRST_VALUE(id) OVER (
           PARTITION BY conversation_id, external_id
           ORDER BY created_at NULLS LAST, id
         ) AS canonical_id
  FROM inbox_messages
  WHERE external_id IS NOT NULL
) d
WHERE m.id = d.id AND d.id <> d.canonical_id;

DROP INDEX IF EXISTS uq_inbox_messages_source;
CREATE UNIQUE INDEX uq_inbox_messages_source
  ON inbox_messages(conversation_id, external_id);

-- Collapse duplicate daily account snapshots before making the daily source key
-- authoritative for future sync runs.
DELETE FROM account_analytics a
USING (
  SELECT id,
         FIRST_VALUE(id) OVER (
           PARTITION BY account_id, platform, recorded_at
           ORDER BY recorded_at, id
         ) AS canonical_id
  FROM account_analytics
) d
WHERE a.id = d.id AND d.id <> d.canonical_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_account_analytics_daily_source
  ON account_analytics(account_id, platform, recorded_at);

-- A connected account must never ingest under another platform/account.
-- Service-role sync functions use these checks before writing; RLS remains the
-- user-facing workspace boundary already present on the base tables.
CREATE INDEX IF NOT EXISTS idx_post_platform_targets_account_external
  ON post_platform_targets(account_id, platform, external_id)
  WHERE external_id IS NOT NULL;

-- Realtime is required by the existing Inbox hook for newly ingested messages.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'inbox_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox_conversations;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'inbox_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox_messages;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'post_analytics'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE post_analytics;
  END IF;
END $$;

-- Content Insights is derived in SQL after analytics ingestion. Publish the
-- derived rows as well so the existing UI can refresh when the learning cycle
-- completes, without introducing a second polling or orchestration path.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'content_performance_baselines',
    'content_learnings',
    'content_recommendations',
    'content_fatigue_signals'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', v_table);
    END IF;
  END LOOP;
END $$;
