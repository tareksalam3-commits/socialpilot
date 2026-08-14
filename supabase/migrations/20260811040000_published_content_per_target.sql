/*
# SocialPilot — Post Phase 3 Audit fix (section 9)
# Master Content vs Platform Variant vs Published Version

## Finding
The Platform Adaptation engine already generates a distinct adapted text
per platform (stored at post.metadata.assistant.platform_variants), but
publishPost()/retryTarget() in supabase/functions/_shared/orchestrator.ts
always sent post.content (the master) to every platform regardless of any
variant. Performance Analysis (post_analytics, content_patterns) was
therefore always scored against the master text, never the text that was
actually posted to a given platform.

## Fix
orchestrator.ts now resolves the platform-specific variant per target when
one exists, falling back to the master content otherwise (manually-authored
posts, or a platform the Adaptation step didn't produce a variant for).
This column persists exactly what was sent for each target, so the
Master Content -> Platform Variant -> Published Version chain the audit
asked about is now inspectable and traceable, not just inferred.
*/

ALTER TABLE post_platform_targets
  ADD COLUMN IF NOT EXISTS published_content text;

COMMENT ON COLUMN post_platform_targets.published_content IS
  'Exact text sent to this platform at publish time (platform variant if one existed, otherwise the post''s master content). Null until the target reaches status=published.';
