import type { ContentQualityResult, QualityDimensionEvidence, QualityDimensionKey } from '@/types/assistant';
import { QUALITY_DIMENSION_KEYS, QUALITY_DIMENSION_THRESHOLDS, evaluateQualityRubric } from '@/engines/qualityEngine/qualityRubric';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

function evidenceFor(key: QualityDimensionKey, score: number): QualityDimensionEvidence {
  return {
    dimension: key,
    score,
    reason: `تمت مراجعة ${key} مقابل النص والغرض المحدد.`,
    evidence: ['مقتطف واضح من النص'],
    suggested_fix: `حسّن ${key} وفقًا للملاحظة المحددة.`,
  };
}

function publishReady(overrides: Partial<ContentQualityResult> = {}): ContentQualityResult {
  const scores = Object.fromEntries(QUALITY_DIMENSION_KEYS.map((key) => [key, Math.max(QUALITY_DIMENSION_THRESHOLDS[key], 92)])) as Partial<Record<QualityDimensionKey, number>>;
  const dimension_evidence = QUALITY_DIMENSION_KEYS.map((key) => evidenceFor(key, scores[key] ?? 92));
  return {
    approved: true,
    score: 93,
    issues: [],
    suggestions: [],
    arabic_quality: 93,
    linkedin_fit: 92,
    brand_fit: 93,
    critical_issues: [],
    ...scores,
    dimension_evidence,
    ...overrides,
  };
}

function degraded(dimension: QualityDimensionKey, score: number, criticalIssue?: string): ContentQualityResult {
  const quality = publishReady({ [dimension]: score });
  quality.dimension_evidence = (quality.dimension_evidence ?? []).map((item) => item.dimension === dimension ? evidenceFor(dimension, score) : item);
  if (criticalIssue) quality.critical_issues = [criticalIssue];
  return quality;
}

const cases: Array<{ name: string; content: string; quality: ContentQualityResult; expected: boolean; expectedReason: string }> = [
  {
    name: 'generic short copy with a weak hook',
    content: 'نحن الأفضل. تواصل معنا الآن.',
    quality: degraded('hook_score', 42),
    expected: false,
    expectedReason: 'hook_score_below_minimum',
  },
  {
    name: 'copy that ignores the target audience',
    content: 'الجميع يحتاج هذه الخدمة الرائعة.',
    quality: degraded('audience_score', 48),
    expected: false,
    expectedReason: 'audience_score_below_minimum',
  },
  {
    name: 'unsupported factual claim',
    content: 'نضمن زيادة المبيعات 300% خلال أسبوع.',
    quality: degraded('factual_score', 30, 'factual_error'),
    expected: false,
    expectedReason: 'critical:factual_error',
  },
  {
    name: 'valuable copy with no usable call to action',
    content: 'هذه ثلاث خطوات عملية لترتيب ميزانيتك الشهرية.',
    quality: degraded('cta_score', 35),
    expected: false,
    expectedReason: 'cta_score_below_minimum',
  },
  {
    name: 'template-like repetitive copy',
    content: 'حلنا الأفضل دائمًا. حلنا الأفضل دائمًا. حلنا الأفضل دائمًا.',
    quality: degraded('originality_score', 25),
    expected: false,
    expectedReason: 'originality_score_below_minimum',
  },
  {
    name: 'language with poor readability',
    content: 'تحسين الإدارة مما يجعل أن يكون تقليل المواءمة المستهدف الضروري.',
    quality: degraded('language_score', 50),
    expected: false,
    expectedReason: 'language_score_below_minimum',
  },
  {
    name: 'platform-inappropriate content',
    content: 'عرض طويل بلا فقرات أو سياق أو صيغة مناسبة للمنصة المستهدفة.',
    quality: degraded('platform_score', 55),
    expected: false,
    expectedReason: 'platform_score_below_minimum',
  },
  {
    name: 'brand voice violation',
    content: 'اشترِ فورًا وإلا ستندم. لا تفوّت الفرصة أبدًا.',
    quality: degraded('brand_score', 45, 'brand_violation'),
    expected: false,
    expectedReason: 'critical:brand_violation',
  },
  {
    name: 'unsafe compliance-sensitive advice',
    content: 'اتخذ القرار المالي الآن دون استشارة أي مختص.',
    quality: degraded('safety_score', 15, 'unsafe_content'),
    expected: false,
    expectedReason: 'critical:unsafe_content',
  },
  {
    name: 'unclear and cluttered draft',
    content: 'فكرة الفكرة وتفاصيل كثيرة غير مرتبة بلا نتيجة أو تسلسل واضح للقارئ.',
    quality: degraded('clarity_score', 55),
    expected: false,
    expectedReason: 'clarity_score_below_minimum',
  },
];

for (const item of cases) {
  const verdict = evaluateQualityRubric(item.quality, true);
  check(`${item.name} is rejected`, verdict.approved === item.expected);
  check(`${item.name} exposes its failure reason`, verdict.reasons.includes(item.expectedReason));
}

const strongVerdict = evaluateQualityRubric(publishReady(), true);
check('strong, evidence-backed content is approved', strongVerdict.approved === true);

const noEvidence = publishReady({ dimension_evidence: [] });
const noEvidenceVerdict = evaluateQualityRubric(noEvidence, true);
check('high scores without dimension evidence are rejected', noEvidenceVerdict.approved === false);
check('missing evidence exposes a deterministic reason', noEvidenceVerdict.reasons.includes('safety_score_evidence_missing'));

console.log(`\n=== Quality calibration: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
