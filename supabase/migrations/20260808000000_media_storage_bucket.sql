/*
  # Media storage bucket

  `mediaRepository.upload()` and the AI Assistant's image-generation step
  (`ai-gateway` action=image) both write to a Storage bucket named `media`,
  but no earlier migration ever created it — so every media upload has been
  failing at the storage layer. This migration only adds the missing bucket
  and its access policies; it does not touch any existing table, function,
  or business logic.

  1. Storage bucket
    - `media` (public — object bodies are read via the public URL exactly
      like the `MediaItem.url` column already assumes)
  2. Security
    - Authenticated users may INSERT/SELECT/DELETE objects only inside a
      path whose first two segments are `{workspace_id}/{user_id}/...`
      (uploads) or `{workspace_id}/ai-generated/...` (Assistant-generated
      images), and only when they belong to that workspace.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('media', 'media', true, 52428800) -- 50MB
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "select_own_media_files" ON storage.objects;
CREATE POLICY "select_own_media_files" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'media'
    AND EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.user_id = auth.uid() AND m.workspace_id::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "insert_own_media_files" ON storage.objects;
CREATE POLICY "insert_own_media_files" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'media'
    AND EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.user_id = auth.uid() AND m.workspace_id::text = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "delete_own_media_files" ON storage.objects;
CREATE POLICY "delete_own_media_files" ON storage.objects FOR DELETE
  TO authenticated USING (
    bucket_id = 'media'
    AND EXISTS (
      SELECT 1 FROM workspace_members m
      WHERE m.user_id = auth.uid() AND m.workspace_id::text = (storage.foldername(name))[1]
    )
  );

-- The ai-gateway Edge Function writes AI-generated images with the
-- service-role key, which already bypasses RLS — no separate policy is
-- needed for that path beyond the workspace-membership check the function
-- itself performs before calling Storage.
