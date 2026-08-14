-- Ensure every real post can participate in Content Insights.
-- Assistant-created posts may already have rich characteristics; this migration
-- only supplies deterministic fields directly available on the posts row.
-- No synthetic topic, pillar, hook, CTA, tone, or audience is invented.

CREATE OR REPLACE FUNCTION public.ensure_post_content_characteristics()
RETURNS trigger
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_char_count integer := char_length(COALESCE(NEW.content, ''));
  v_length_bucket text;
  v_format text;
BEGIN
  v_length_bucket := CASE
    WHEN v_char_count <= 280 THEN 'short'
    WHEN v_char_count <= 1000 THEN 'medium'
    ELSE 'long'
  END;
  v_format := CASE
    WHEN COALESCE(cardinality(NEW.media_urls), 0) > 0 THEN 'media'
    ELSE 'text'
  END;

  INSERT INTO content_characteristics (
    post_id, workspace_id, format, length_bucket, char_count,
    platforms, publishing_time, source
  )
  VALUES (
    NEW.id, NEW.workspace_id, v_format, v_length_bucket, v_char_count,
    COALESCE(NEW.platforms, '{}'),
    COALESCE(NEW.published_at, NEW.scheduled_for, NEW.created_at),
    jsonb_build_object(
      'kind', 'post_metadata',
      'source_post_id', NEW.id,
      'generated_at', now()
    )
  )
  ON CONFLICT (post_id) DO UPDATE SET
    workspace_id = EXCLUDED.workspace_id,
    format = COALESCE(content_characteristics.format, EXCLUDED.format),
    length_bucket = EXCLUDED.length_bucket,
    char_count = EXCLUDED.char_count,
    platforms = EXCLUDED.platforms,
    publishing_time = EXCLUDED.publishing_time,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_post_content_characteristics ON posts;
CREATE TRIGGER trg_ensure_post_content_characteristics
  AFTER INSERT OR UPDATE OF content, platforms, media_urls, scheduled_for, published_at, status
  ON posts
  FOR EACH ROW EXECUTE FUNCTION ensure_post_content_characteristics();

-- Backfill existing posts exactly once. Rich Assistant rows are preserved by
-- the conflict handler; manually-created/imported posts gain only factual
-- metadata needed for format/time/length analysis.
INSERT INTO content_characteristics (
  post_id, workspace_id, format, length_bucket, char_count,
  platforms, publishing_time, source
)
SELECT
  p.id,
  p.workspace_id,
  CASE WHEN COALESCE(cardinality(p.media_urls), 0) > 0 THEN 'media' ELSE 'text' END,
  CASE
    WHEN char_length(COALESCE(p.content, '')) <= 280 THEN 'short'
    WHEN char_length(COALESCE(p.content, '')) <= 1000 THEN 'medium'
    ELSE 'long'
  END,
  char_length(COALESCE(p.content, '')),
  COALESCE(p.platforms, '{}'),
  COALESCE(p.published_at, p.scheduled_for, p.created_at),
  jsonb_build_object(
    'kind', 'post_metadata_backfill',
    'source_post_id', p.id,
    'generated_at', now()
  )
FROM posts p
WHERE NOT EXISTS (
  SELECT 1 FROM content_characteristics cc WHERE cc.post_id = p.id
);

GRANT EXECUTE ON FUNCTION public.ensure_post_content_characteristics() TO authenticated, service_role;

COMMENT ON FUNCTION public.ensure_post_content_characteristics() IS
  'Populates only factual post metadata for Content Insights; never invents semantic characteristics.';
