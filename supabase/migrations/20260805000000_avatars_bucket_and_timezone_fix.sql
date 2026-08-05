-- ============================================================
-- Avatar uploads + Egypt timezone fix
-- ============================================================
-- 1. `avatars` storage bucket so profile pictures are uploaded directly
--    from the device instead of pasting an external URL.
-- 2. Fixes the workspace `timezone` column, which defaulted to 'UTC'
--    (wrong for this app's users, who are in Egypt) and is no longer
--    editable/visible in the UI, so it must be correct at the DB level.

-- ------------------------------------------------------------
-- 1. Avatars bucket
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO NOTHING;

-- Anyone can view avatars (bucket is public, needed to render them in the UI)
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- A user may only upload into their own folder: avatars/{user_id}/...
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- 2. Correct default timezone (Egypt)
-- ------------------------------------------------------------
ALTER TABLE public.workspaces ALTER COLUMN timezone SET DEFAULT 'Africa/Cairo';

-- Existing workspaces that were silently left on the wrong default.
UPDATE public.workspaces SET timezone = 'Africa/Cairo' WHERE timezone = 'UTC';
