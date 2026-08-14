-- Quality proof is bound to the exact post text that was reviewed.
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS quality_proof jsonb;

CREATE INDEX IF NOT EXISTS idx_posts_content_hash ON posts (content_hash);

COMMENT ON COLUMN posts.content_hash IS 'SHA-256 hash of the exact content string reviewed by Dedicated QC.';
COMMENT ON COLUMN posts.quality_proof IS 'Machine-readable QC evidence bound to content_hash and reviewed platform variants.';

-- Never allow a scheduled/publishing/published row without an integrity proof.
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_publish_requires_quality_proof;
ALTER TABLE posts ADD CONSTRAINT posts_publish_requires_quality_proof CHECK (
  status NOT IN ('scheduled', 'publishing', 'published')
  OR (
    content_hash IS NOT NULL
    AND length(content_hash) = 64
    AND quality_proof IS NOT NULL
    AND COALESCE((quality_proof->>'approved')::boolean, false) = true
    AND quality_proof->>'content_hash' = content_hash
  )
);

-- Protect the proof from accidental mutation after publication.
CREATE OR REPLACE FUNCTION prevent_published_quality_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('scheduled', 'publishing', 'published') AND (
    NEW.content IS DISTINCT FROM OLD.content OR
    NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
    NEW.quality_proof IS DISTINCT FROM OLD.quality_proof
  ) THEN
    RAISE EXCEPTION 'Published/scheduled content cannot change without a fresh quality proof';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_published_quality_mutation ON posts;
CREATE TRIGGER trg_prevent_published_quality_mutation
  BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION prevent_published_quality_mutation();
