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

export async function buildQualityProof(
  content: string,
  quality: {
    approved: boolean;
    score: number;
    arabic_quality?: number;
    linkedin_fit?: number;
    brand_fit?: number;
    critical_issues?: string[];
  },
  reviewedPlatform?: string,
): Promise<QualityProof | null> {
  const isLinkedIn = reviewedPlatform?.toLowerCase().includes('linkedin') ?? false;
  if (
    !quality.approved ||
    typeof quality.score !== 'number' || quality.score < 90 ||
    typeof quality.arabic_quality !== 'number' || quality.arabic_quality < 90 ||
    typeof quality.brand_fit !== 'number' || quality.brand_fit < 90 ||
    (isLinkedIn && (typeof quality.linkedin_fit !== 'number' || quality.linkedin_fit < 90)) ||
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
