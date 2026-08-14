import type { ContentQualityResult, QualityDimensionEvidence, QualityDimensionKey } from '@/types/assistant';

/**
 * Deterministic acceptance policy for AI-authored content. The model may
 * describe the evidence, but code owns the approval decision and never
 * accepts a high aggregate score in place of a weak critical dimension.
 *
 * Calibration bands used by the evaluator prompt and reports:
 * 0–49 = broken or unsafe, 50–69 = materially weak, 70–84 = usable draft,
 * 85–89 = strong but still below publishing quality, 90–94 = publish-ready,
 * 95–100 = exceptional. Only dimensions with an explicit threshold may pass.
 */
export const QUALITY_SCORE_BANDS = [
  { min: 0, max: 49, label: 'broken_or_unsafe' },
  { min: 50, max: 69, label: 'materially_weak' },
  { min: 70, max: 84, label: 'usable_draft' },
  { min: 85, max: 89, label: 'strong_but_not_publish_ready' },
  { min: 90, max: 94, label: 'publish_ready' },
  { min: 95, max: 100, label: 'exceptional' },
] as const;

export const QUALITY_DIMENSION_THRESHOLDS: Record<QualityDimensionKey, number> = {
  objective_score: 85,
  audience_score: 85,
  brand_score: 90,
  platform_score: 90,
  language_score: 90,
  clarity_score: 85,
  readability_score: 85,
  hook_score: 80,
  value_score: 85,
  cta_score: 75,
  originality_score: 80,
  factual_score: 90,
  safety_score: 95,
};

const DIMENSION_LABELS: Record<QualityDimensionKey, string> = {
  objective_score: 'تحقيق الهدف',
  audience_score: 'ملاءمة الجمهور',
  brand_score: 'التوافق مع هوية البراند',
  platform_score: 'ملاءمة المنصة',
  language_score: 'جودة اللغة',
  clarity_score: 'وضوح الفكرة',
  readability_score: 'سهولة القراءة',
  hook_score: 'قوة البداية',
  value_score: 'القيمة المقدمة',
  cta_score: 'جودة الدعوة للإجراء',
  originality_score: 'الأصالة وعدم التكرار',
  factual_score: 'صحة الادعاءات',
  safety_score: 'سلامة المحتوى',
};

export const QUALITY_DIMENSION_KEYS = Object.keys(QUALITY_DIMENSION_THRESHOLDS) as QualityDimensionKey[];

function numericScore(quality: ContentQualityResult, key: QualityDimensionKey): number | undefined {
  const direct = quality[key];
  if (typeof direct === 'number') return direct;

  // Backward-compatible aliases are accepted as a score signal, but they do
  // not waive the required evidence returned by the recalibrated evaluator.
  if (key === 'brand_score' && typeof quality.brand_fit === 'number') return quality.brand_fit;
  if (key === 'platform_score' && typeof quality.linkedin_fit === 'number') return quality.linkedin_fit;
  if (key === 'language_score' && typeof quality.arabic_quality === 'number') return quality.arabic_quality;
  if (key === 'value_score' && typeof quality.relevance_score === 'number') return quality.relevance_score;
  return undefined;
}

function normalizedEvidence(quality: ContentQualityResult): Map<QualityDimensionKey, QualityDimensionEvidence> {
  const evidence = new Map<QualityDimensionKey, QualityDimensionEvidence>();
  for (const item of quality.dimension_evidence ?? []) {
    if (!QUALITY_DIMENSION_KEYS.includes(item.dimension)) continue;
    if (typeof item.score !== 'number' || !Number.isFinite(item.score)) continue;
    if (!item.reason?.trim() || !item.suggested_fix?.trim()) continue;
    evidence.set(item.dimension, item);
  }
  return evidence;
}

export type QualityRubricVerdict = {
  approved: boolean;
  reasons: string[];
  failedDimensions: QualityDimensionEvidence[];
};

/**
 * Applies all hard gates in deterministic code. The returned reasons are
 * stable machine-readable identifiers that feed the rewrite loop and quality
 * proof; the model's free-form narrative never decides whether content passes.
 */
export function evaluateQualityRubric(quality: ContentQualityResult | null, linkedInTarget: boolean): QualityRubricVerdict {
  if (!quality) return { approved: false, reasons: ['qc_unavailable'], failedDimensions: [] };

  const reasons: string[] = [];
  const evidenceByDimension = normalizedEvidence(quality);
  const failedDimensions: QualityDimensionEvidence[] = [];

  if (quality.critical_issues?.length) reasons.push(...quality.critical_issues.map((issue) => `critical:${issue}`));
  if (typeof quality.score !== 'number' || quality.score < 90) reasons.push('score_below_minimum');

  for (const key of QUALITY_DIMENSION_KEYS) {
    const minimum = QUALITY_DIMENSION_THRESHOLDS[key];
    const score = numericScore(quality, key);
    const evidence = evidenceByDimension.get(key);

    if (typeof score !== 'number') {
      reasons.push(`${key}_missing`);
      continue;
    }
    if (!evidence) {
      reasons.push(`${key}_evidence_missing`);
      continue;
    }
    if (score < minimum) {
      reasons.push(`${key}_below_minimum`);
      failedDimensions.push({
        ...evidence,
        score,
        reason: evidence.reason || `${DIMENSION_LABELS[key]} أقل من المعيار المطلوب.`,
        suggested_fix: evidence.suggested_fix || `حسّن ${DIMENSION_LABELS[key]} قبل إعادة التقييم.`,
      });
    }
  }

  // LinkedIn has a legacy platform-specific score in addition to the general
  // platform dimension. Requiring it keeps existing contracts intact.
  if (linkedInTarget && (typeof quality.linkedin_fit !== 'number' || quality.linkedin_fit < 90)) {
    reasons.push(typeof quality.linkedin_fit === 'number' ? 'linkedin_fit_below_minimum' : 'linkedin_fit_missing');
  }
  if (typeof quality.arabic_quality !== 'number' || quality.arabic_quality < 90) {
    reasons.push(typeof quality.arabic_quality === 'number' ? 'arabic_quality_below_minimum' : 'arabic_quality_missing');
  }
  if (typeof quality.brand_fit !== 'number' || quality.brand_fit < 90) {
    reasons.push(typeof quality.brand_fit === 'number' ? 'brand_fit_below_minimum' : 'brand_fit_missing');
  }

  const modelClaimsApproval = quality.approved === true;
  if (!modelClaimsApproval) reasons.push('qc_not_approved');
  return { approved: modelClaimsApproval && reasons.length === 0, reasons, failedDimensions };
}

export function qualityDimensionLabel(key: QualityDimensionKey): string {
  return DIMENSION_LABELS[key];
}
