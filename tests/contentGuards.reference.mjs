// Standalone reproduction of the deterministic guard logic in
// src/engines/contentEngine/contentGuards.ts, used here ONLY to verify the
// algorithm's behavior against the required test cases, since the full TS
// project could not be installed/compiled in this sandbox (no network
// access to the npm registry). The logic below is copied verbatim from the
// real implementation, including the QC Hardening Pass (Aug 2026) Critical
// Dimension Gate.

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

// QC Hardening Pass — common generic/cliché openers, hardcoded as a
// deterministic backstop (see contentGuards.ts for the full rationale).
const CLICHE_OPENER_PATTERNS = [
  /^\s*في عالم(نا)?\s+(اليوم|الحالي)/,
  /^\s*في ظل\s+(التطورات|التحديات|الظروف)\s+المتسارعة/,
  /^\s*لا شك أن/,
  /^\s*بدون أدنى شك/,
  /^\s*من المهم جدًا أن ندرك/,
  /^\s*في عصر\s+(التكنولوجيا|السرعة|المعلومات)/,
];

const FOREIGN_SCRIPT_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Cyrillic}|\p{Script=Devanagari}|\p{Script=Thai}|\p{Script=Hebrew}/u;
const ACCENTED_LATIN_WORD_RE = /[a-zA-Z]*[àâäáãåāèéêëēìíîïīòóôöõøōùúûüūçñÿ][a-zA-Z]*/;

function arabicNaturalnessGuard(text) {
  const trimmed = text.trim();
  const reasons = [];
  if (trimmed.length < 20) reasons.push('too_short');
  const arabicChars = (trimmed.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latinChars = (trimmed.match(/[a-zA-Z]/g) ?? []).length;
  if (arabicChars > 0 && latinChars > arabicChars * 0.6) reasons.push('excessive_latin_mixing');
  if (FOREIGN_SCRIPT_RE.test(trimmed)) reasons.push('non_arabic_script_leak');
  if (arabicChars > 0 && ACCENTED_LATIN_WORD_RE.test(trimmed)) reasons.push('accented_latin_word_leak');
  if (/(\S+)(\s+\1){2,}/.test(trimmed)) reasons.push('abnormal_repetition');
  if (KNOWN_BAD_ARABIC_PATTERNS.some((p) => trimmed.includes(p))) reasons.push('known_bad_pattern');
  if (CLICHE_OPENER_PATTERNS.some((p) => p.test(trimmed))) reasons.push('cliche_opener');
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    const shortWordRatio = words.filter((w) => w.replace(/[^\u0600-\u06FF]/g, '').length <= 2).length / words.length;
    if (shortWordRatio > 0.5) reasons.push('word_salad');
  }
  if (METADATA_PATTERNS.some((p) => p.re.test(trimmed))) reasons.push('metadata_leak');
  return { pass: reasons.length === 0, reasons };
}

const QC_MIN_SCORE = 90;
const QC_MIN_CRITICAL_DIMENSION = 90;

// The six dimensions that alone can fail content no matter how high every
// other score (or the overall average) is.
const CRITICAL_QUALITY_DIMENSIONS = ['idea_value', 'hook', 'arabic_quality', 'naturalness', 'brand_fit', 'platform_fit'];

function criticalDimensionScore(quality, dim, linkedInTarget) {
  const fromDimensions = quality.dimensions?.[dim]?.score;
  if (typeof fromDimensions === 'number') return fromDimensions;
  switch (dim) {
    case 'idea_value': return quality.content_value_score;
    case 'hook': return quality.hook_score;
    case 'arabic_quality': return quality.arabic_quality;
    case 'naturalness': return quality.naturalness_score;
    case 'brand_fit': return quality.brand_fit ?? quality.brand_score;
    case 'platform_fit': return linkedInTarget ? (quality.linkedin_fit ?? quality.platform_score) : quality.platform_score;
    default: return undefined;
  }
}

function evaluateContentApproval(content, quality, linkedInTarget) {
  const guard = arabicNaturalnessGuard(content);
  const reasons = guard.pass ? [] : guard.reasons.map((r) => `guard:${r}`);
  if (!quality) {
    reasons.push('qc_unavailable');
    return { approved: false, reasons };
  }
  if (quality.critical_issues?.length) {
    reasons.push(...quality.critical_issues.map((i) => `critical:${i}`));
  }
  if (typeof quality.score !== 'number' || quality.score < QC_MIN_SCORE) reasons.push('score_below_minimum');

  for (const dim of CRITICAL_QUALITY_DIMENSIONS) {
    if (dim === 'platform_fit' && !linkedInTarget) continue;
    const value = criticalDimensionScore(quality, dim, linkedInTarget);
    if (value === undefined) reasons.push(`${dim}_missing`);
    else if (value < QC_MIN_CRITICAL_DIMENSION) reasons.push(`${dim}_below_minimum`);
  }

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

/** Helper only used by the calibration test set below: builds a full
 * 12-dimension QC result (as reviewGeneratedContent/parseQCResult would)
 * from a partial map of dimension scores, defaulting anything unspecified
 * to 95 (a "good" score) so a test case only needs to name its flaw(s). */
function makeQuality(dimensionScores, extra = {}) {
  const keys = ['idea_value', 'hook', 'substance', 'structure', 'arabic_quality', 'naturalness', 'brand_fit', 'audience_fit', 'platform_fit', 'cta', 'originality', 'factual_logical'];
  const dimensions = {};
  for (const k of keys) {
    const score = dimensionScores[k] ?? 95;
    dimensions[k] = { score, status: score >= 90 ? 'pass' : 'fail', reason: '', evidence: '', suggested_fix: '' };
  }
  const score = Math.round(keys.reduce((sum, k) => sum + dimensions[k].score, 0) / keys.length);
  return { approved: false, score, issues: [], suggestions: [], dimensions, critical_issues: extra.critical_issues ?? [] };
}

export { sanitizeGeneratedContent, arabicNaturalnessGuard, evaluateContentApproval, validateFinalPostContent, makeQuality, CRITICAL_QUALITY_DIMENSIONS };
