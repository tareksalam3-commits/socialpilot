import type { ContentQualityResult, QualityDimensionEvidence, QualityDimensionKey } from '@/types/assistant';
import { QUALITY_DIMENSION_KEYS, evaluateQualityRubric } from '@/engines/qualityEngine/qualityRubric';

export type QualityProof = {
  approved: true;
  score: number;
  arabic_quality: number;
  linkedin_fit: number;
  brand_fit: number;
  critical_issues: string[];
  /** Immutable evidence used by the deterministic evaluator at approval time. */
  quality_dimensions: Record<QualityDimensionKey, number>;
  dimension_evidence: QualityDimensionEvidence[];
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

function dimensionScore(quality: ContentQualityResult, key: QualityDimensionKey): number {
  const direct = quality[key];
  if (typeof direct === 'number') return direct;
  if (key === 'brand_score') return quality.brand_fit ?? 0;
  if (key === 'platform_score') return quality.linkedin_fit ?? 0;
  if (key === 'language_score') return quality.arabic_quality ?? 0;
  if (key === 'value_score') return quality.relevance_score ?? 0;
  return 0;
}

/** Builds the evidence bound to the exact reviewed content. It intentionally
 * mirrors the evaluator's acceptance policy; a legacy thin proof cannot be
 * created for content that lacks per-dimension evidence. */
/** Verifies that a supplied proof remains bound to this exact content and
 * contains the full evidence set required by the current rubric. */
export async function isQualityProofValidForContent(content: string, proof: unknown): Promise<boolean> {
  if (!proof || typeof proof !== 'object') return false;
  const value = proof as Record<string, unknown>;
  if (value.approved !== true || typeof value.content_hash !== 'string') return false;
  if (value.content_hash !== await sha256(content)) return false;
  const dimensions = value.quality_dimensions;
  const evidence = value.dimension_evidence;
  if (!dimensions || typeof dimensions !== 'object' || !Array.isArray(evidence)) return false;
  const dimensionRecord = dimensions as Record<string, unknown>;
  const evidenceKeys = new Set(
    evidence.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      return typeof entry.dimension === 'string' && typeof entry.score === 'number' && typeof entry.reason === 'string' && entry.reason.trim() && typeof entry.suggested_fix === 'string' && entry.suggested_fix.trim() ? [entry.dimension] : [];
    }),
  );
  return QUALITY_DIMENSION_KEYS.every((key) => typeof dimensionRecord[key] === 'number' && evidenceKeys.has(key));
}

export async function buildQualityProof(
  content: string,
  quality: ContentQualityResult,
  reviewedPlatform?: string,
): Promise<QualityProof | null> {
  const isLinkedIn = reviewedPlatform?.toLowerCase().includes('linkedin') ?? false;
  const rubric = evaluateQualityRubric(quality, isLinkedIn);
  if (!rubric.approved || typeof quality.arabic_quality !== 'number' || typeof quality.brand_fit !== 'number') return null;

  const content_hash = await sha256(content);
  const quality_dimensions = Object.fromEntries(
    QUALITY_DIMENSION_KEYS.map((key) => [key, dimensionScore(quality, key)]),
  ) as Record<QualityDimensionKey, number>;

  return {
    approved: true,
    score: quality.score,
    arabic_quality: quality.arabic_quality,
    linkedin_fit: quality.linkedin_fit ?? 0,
    brand_fit: quality.brand_fit,
    critical_issues: quality.critical_issues ?? [],
    quality_dimensions,
    dimension_evidence: quality.dimension_evidence ?? [],
    content_hash,
    reviewed_content: content,
    reviewed_platform: reviewedPlatform,
    reviewed_at: new Date().toISOString(),
  };
}
