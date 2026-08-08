/*
# Content Sources

Adds the "مصادر المحتوى" (Content Sources) feature: the user links up to 10
external sources (RSS, web/blog URLs, PDF/Word/Excel files, YouTube links)
once, then triggers a fetch that pulls the latest content, filters it
against the workspace's Brand Voice, and returns AI-generated summaries to
the frontend. Raw extracted content is never persisted — only a hash of it
is kept, purely to detect and skip content already processed.

## New Tables
- `content_sources` — one row per linked source (id, workspace_id, type,
  source_url, file_path, metadata, last_fetched_at, last_processed_hash,
  status, last_error). Capped at 10 rows per workspace via trigger.

## Explicitly NOT created
- No `content_extractions` table — extracted content is processed in-memory
  inside the `content-extraction` edge function and streamed back to the
  client as summaries; only `last_processed_hash` is persisted, to avoid
  storing raw scraped/document content in the database.

## Storage
- New private bucket `content-sources` for uploaded PDF/Word/Excel files.
  Objects are keyed `{workspace_id}/{user_id}/{filename}` and access is
  scoped to workspace members via `storage.objects` policies, matching the
  `workspace_id`-based RLS used everywhere else in this project.

## Security
- RLS on `content_sources`, scoped via `workspace_members` (same pattern as
  `posts`, `media_items`, etc).
- `enforce_content_sources_limit` trigger blocks a workspace from linking
  more than 10 sources.
*/

-- ============================================================
-- content_sources
-- ============================================================
CREATE TABLE IF NOT EXISTS content_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('rss', 'url', 'pdf', 'word', 'excel', 'youtube')),
  name text,
  source_url text,
  file_path text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_fetched_at timestamptz,
  last_processed_hash text,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'fetching', 'ready', 'error')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_sources_has_location CHECK (source_url IS NOT NULL OR file_path IS NOT NULL)
);

ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_content_sources_workspace_id ON content_sources(workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_sources_type ON content_sources(type);
CREATE INDEX IF NOT EXISTS idx_content_sources_created_at ON content_sources(created_at DESC);

DROP POLICY IF EXISTS "select_own_content_sources" ON content_sources;
CREATE POLICY "select_own_content_sources" ON content_sources FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_sources.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_own_content_sources" ON content_sources;
CREATE POLICY "insert_own_content_sources" ON content_sources FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_sources.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_own_content_sources" ON content_sources;
CREATE POLICY "update_own_content_sources" ON content_sources FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_sources.workspace_id AND m.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_sources.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_own_content_sources" ON content_sources;
CREATE POLICY "delete_own_content_sources" ON content_sources FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = content_sources.workspace_id AND m.user_id = auth.uid())
  );

-- updated_at bookkeeping, consistent with the rest of the schema.
CREATE OR REPLACE FUNCTION public.trg_content_sources_updated_at() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_sources_updated_at ON content_sources;
CREATE TRIGGER content_sources_updated_at
  BEFORE UPDATE ON content_sources
  FOR EACH ROW EXECUTE FUNCTION trg_content_sources_updated_at();

-- Hard cap of 10 linked sources per workspace.
CREATE OR REPLACE FUNCTION public.enforce_content_sources_limit() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count integer;
BEGIN
  SELECT count(*) INTO current_count FROM content_sources WHERE workspace_id = NEW.workspace_id;
  IF current_count >= 10 THEN
    RAISE EXCEPTION 'content_sources_limit_reached: workspace % already has 10 linked sources', NEW.workspace_id
      USING HINT = 'Remove an existing source before adding a new one.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_sources_limit ON content_sources;
CREATE TRIGGER content_sources_limit
  BEFORE INSERT ON content_sources
  FOR EACH ROW EXECUTE FUNCTION enforce_content_sources_limit();

-- ============================================================
-- Storage: content-sources bucket (private — PDF/Word/Excel uploads)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('content-sources', 'content-sources', false, 26214400) -- 25MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "select_own_content_source_files" ON storage.objects;
CREATE POLICY "select_own_content_source_files" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'content-sources'
    AND EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.user_id = auth.uid() AND m.workspace_id::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "insert_own_content_source_files" ON storage.objects;
CREATE POLICY "insert_own_content_source_files" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'content-sources'
    AND EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.user_id = auth.uid() AND m.workspace_id::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "delete_own_content_source_files" ON storage.objects;
CREATE POLICY "delete_own_content_source_files" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'content-sources'
    AND EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.user_id = auth.uid() AND m.workspace_id::text = (storage.foldername(name))[1]
    )
  );
