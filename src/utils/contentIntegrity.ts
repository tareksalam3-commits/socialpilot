export type QualityProof = {
  approved: true;
  score: number;
  arabic_quality: number;
  linkedin_fit: number;
  brand_fit: number;
  critical_issues: string[];
  content_hash: string;
  reviewed_content: string;
  reviewed_platform?: string;
  reviewed_at: string;
};

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** QC Hardening Pass (brief item 10) — the Publish Security Gate itself
 * (content_hash / quality_proof / platform_variant_proof / generation_origin
 * / the server-side re-check in supabase/functions/_shared/orchestrator.ts)
 * is untouched: same fields, same hash mechanism, same server thresholds.
 * What changed is what this function requires BEFORE it will ever build a
 * proof for content to carry — it now also enforces the Critical Dimension
 * Gate (evaluateContentApproval's own rule) via `dimensions`/legacy flat
 * fields, so a proof can never exist for content that failed on idea_value,
 * hook, or naturalness even though those don't have their own column in
 * `QualityProof`. Those three still show up indirectly in `score` (the
 * code-computed mean of all twelve dimensions in qualityControl.ts), so the
 * server's existing `score >= 90` check keeps working unmodified — this
 * function is simply stricter about when it hands that score a proof at
 * all. `quality.approved` is intentionally NOT read here — same "never
 * trust the model's self-report" rule as evaluateContentApproval. */
export async function buildQualityProof(
  content: string,
  quality: {
    approved: boolean;
    score: number;
    arabic_quality?: number;
    linkedin_fit?: number;
    brand_fit?: number;
    critical_issues?: string[];
    content_value_score?: number;
    hook_score?: number;
    naturalness_score?: number;
    platform_score?: number;
    dimensions?: Partial<Record<string, { score: number }>>;
  },
  reviewedPlatform?: string,
): Promise<QualityProof | null> {
  const isLinkedIn = reviewedPlatform?.toLowerCase().includes('linkedin') ?? false;
  const dim = (key: string, legacy?: number): number | undefined => {
    const fromDimensions = quality.dimensions?.[key]?.score;
    return typeof fromDimensions === 'number' ? fromDimensions : legacy;
  };
  const ideaValue = dim('idea_value', quality.content_value_score);
  const hook = dim('hook', quality.hook_score);
  const naturalness = dim('naturalness', quality.naturalness_score);
  const platformFit = isLinkedIn ? (dim('platform_fit', quality.linkedin_fit) ?? quality.linkedin_fit) : dim('platform_fit', quality.platform_score);

  if (
    typeof quality.score !== 'number' || quality.score < 90 ||
    typeof quality.arabic_quality !== 'number' || quality.arabic_quality < 90 ||
    typeof quality.brand_fit !== 'number' || quality.brand_fit < 90 ||
    (isLinkedIn && (typeof quality.linkedin_fit !== 'number' || quality.linkedin_fit < 90)) ||
    typeof ideaValue !== 'number' || ideaValue < 90 ||
    typeof hook !== 'number' || hook < 90 ||
    typeof naturalness !== 'number' || naturalness < 90 ||
    (isLinkedIn && (typeof platformFit !== 'number' || platformFit < 90)) ||
    (quality.critical_issues?.length ?? 0) > 0
  ) return null;

  const content_hash = await sha256(content);
  return {
    approved: true,
    score: quality.score,
    arabic_quality: quality.arabic_quality,
    linkedin_fit: quality.linkedin_fit ?? 0,
    brand_fit: quality.brand_fit,
    critical_issues: quality.critical_issues ?? [],
    content_hash,
    reviewed_content: content,
    reviewed_platform: reviewedPlatform,
    reviewed_at: new Date().toISOString(),
  };
}
