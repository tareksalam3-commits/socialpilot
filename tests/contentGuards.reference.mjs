// Standalone reproduction of the deterministic guard logic added to
// src/services/assistantOrchestrator.ts, used here ONLY to verify the
// algorithm's behavior against the required test cases, since the full
// TS project could not be installed/compiled in this sandbox (no network
// access to the npm registry). The logic below is copied verbatim from
// the real implementation.

function stripFence(text) {
  return text.trim().replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/i, '').trim();
}

const METADATA_PATTERNS = [
  { re: /\bpreview\b/i, label: 'preview' },
  { re: /\bplatform\s*:/i, label: 'platform' },
  { re: /\baccount\s*:/i, label: 'account' },
  { re: /\bscheduled(\s*time)?\s*:/i, label: 'scheduled' },
  { re: /\bstatus\s*:/i, label: 'status' },
  { re: /awaiting confirmation/i, label: 'awaiting_confirmation' },
  { re: /content score/i, label: 'content_score' },
  { re: /quality score/i, label: 'quality_score' },
  { re: /^\s*final post\b/im, label: 'final_post_label' },
  { re: /```/, label: 'markdown_fence' },
];

function sanitizeGeneratedContent(raw) {
  const text = stripFence(raw);
  const hits = METADATA_PATTERNS.filter((p) => p.re.test(text));
  if (hits.length === 0) {
    return { content: text.trim(), action: text.trim() ? 'ok' : 'regenerate', reasons: text.trim() ? [] : ['empty'] };
  }
  const lines = text.split('\n');
  const metadataLines = lines.filter((line) => METADATA_PATTERNS.some((p) => p.re.test(line)));
  const metadataShare = metadataLines.length / Math.max(1, lines.length);
  if (hits.length >= 2 || metadataShare > 0.3) {
    return { content: text, action: 'regenerate', reasons: hits.map((h) => h.label) };
  }
  const cleaned = lines.filter((line) => !METADATA_PATTERNS.some((p) => p.re.test(line))).join('\n').replace(/```[a-z]*/gi, '').trim();
  if (!cleaned) {
    return { content: text, action: 'regenerate', reasons: hits.map((h) => h.label) };
  }
  return { content: cleaned, action: 'cleaned', reasons: hits.map((h) => h.label) };
}

const KNOWN_BAD_ARABIC_PATTERNS = [
  'مقاييس حماك قنينة أمان',
  'مالية وظيفتك ليست كارثة',
  'مراجعة عتبة رمادية',
  'الشكوك الوهمية',
  'إعداد وثيقة كجسر',
  'تتدحرج الأداء إلى معضلة',
];

function arabicNaturalnessGuard(text) {
  const trimmed = text.trim();
  const reasons = [];
  if (trimmed.length < 20) reasons.push('too_short');
  const arabicChars = (trimmed.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latinChars = (trimmed.match(/[a-zA-Z]/g) ?? []).length;
  if (arabicChars > 0 && latinChars > arabicChars * 0.6) reasons.push('excessive_latin_mixing');
  if (/(\S+)(\s+\1){2,}/.test(trimmed)) reasons.push('abnormal_repetition');
  if (KNOWN_BAD_ARABIC_PATTERNS.some((p) => trimmed.includes(p))) reasons.push('known_bad_pattern');
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    const shortWordRatio = words.filter((w) => w.replace(/[^\u0600-\u06FF]/g, '').length <= 2).length / words.length;
    if (shortWordRatio > 0.5) reasons.push('word_salad');
  }
  if (METADATA_PATTERNS.some((p) => p.re.test(trimmed))) reasons.push('metadata_leak');
  return { pass: reasons.length === 0, reasons };
}

const QC_MIN_SCORE = 80;
const QC_MIN_ARABIC_QUALITY = 80;
const QC_MIN_LINKEDIN_FIT = 75;
const QC_MIN_BRAND_FIT = 75;

function evaluateContentApproval(content, quality, linkedInTarget) {
  const guard = arabicNaturalnessGuard(content);
  const reasons = guard.pass ? [] : guard.reasons.map((r) => `guard:${r}`);
  if (!quality) {
    reasons.push('qc_unavailable');
    return { approved: false, reasons };
  }
  if (!quality.approved) reasons.push('qc_not_approved');
  if (quality.score < QC_MIN_SCORE) reasons.push('score_below_minimum');
  if (typeof quality.arabic_quality === 'number' && quality.arabic_quality < QC_MIN_ARABIC_QUALITY) reasons.push('arabic_quality_below_minimum');
  if (linkedInTarget && typeof quality.linkedin_fit === 'number' && quality.linkedin_fit < QC_MIN_LINKEDIN_FIT) reasons.push('linkedin_fit_below_minimum');
  if (typeof quality.brand_fit === 'number' && quality.brand_fit < QC_MIN_BRAND_FIT) reasons.push('brand_fit_below_minimum');
  return { approved: guard.pass && reasons.length === 0, reasons };
}

function validateFinalPostContent(content) {
  const trimmed = content.trim();
  const reasons = [];
  if (!trimmed) reasons.push('empty_content');
  const sanitized = sanitizeGeneratedContent(trimmed);
  if (sanitized.action !== 'ok') reasons.push(...sanitized.reasons.map((r) => `metadata:${r}`));
  const guard = arabicNaturalnessGuard(trimmed);
  if (!guard.pass) reasons.push(...guard.reasons);
  return { valid: reasons.length === 0, reasons };
}

export { sanitizeGeneratedContent, arabicNaturalnessGuard, evaluateContentApproval, validateFinalPostContent };
