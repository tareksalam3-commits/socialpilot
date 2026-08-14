import type { ContentQualityResult, QualityDecision } from '@/types/assistant';

// ============================================================================
// Deterministic Content Guards
//
// These run in code, never relying on the AI alone, as a backstop to the
// Creator's OUTPUT CONTRACT and the QC agent's Hard Fail Rules. Every
// authoring surface in the app (AI Assistant, Content Sources) follows the
// same pipeline end to end:
//   Extract Source → Understand & Summarize → Rewrite in Professional
//   Egyptian Arabic (Creator, using EGYPTIAN_ARABIC_WRITING_RULES) →
//   sanitizeGeneratedContent() → arabicNaturalnessGuard() →
//   reviewGeneratedContent() (AI QC, dialect-aware) → evaluateContentApproval()
// Extracted source content (RSS/Web/YouTube/PDF/Word/Excel) is never used
// directly in a post — see collectContentContext()/runCreatorAgent() in
// creatorAgent.ts and useContentSources.generatePosts(), both of which only
// ever pass extracted text in as grounding context for the Creator, never as
// the post body itself.
// ============================================================================

export function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

export const QC_MIN_SCORE = 90;
export const QC_MIN_ARABIC_QUALITY = 90;
export const QC_MIN_LINKEDIN_FIT = 90;
export const QC_MIN_BRAND_FIT = 90;

/** Preview/publishing/QC metadata markers that must never appear inside
 * `posts.content` — these belong only in Preview UI, never in the post
 * text itself. Matched line-by-line so a single leaked label can be
 * stripped without discarding the rest of a otherwise-good post. */
const METADATA_PATTERNS: { re: RegExp; label: string }[] = [
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
  // Reasoning-tuned models occasionally leak their internal "thinking" as
  // plain narration instead of (or alongside) a <think> tag the gateway
  // already strips server-side — this catches what slips through: either
  // the literal tag surviving into content, or the model narrating its own
  // reasoning process in prose (English or Arabic) instead of writing the
  // post itself.
  { re: /<\/?think(?:ing)?>/i, label: 'reasoning_tag_leak' },
  { re: /^\s*(okay|ok|alright)?,?\s*(so\s+)?(the user|i need to|i should|let me think|let's think)\b/im, label: 'reasoning_narration' },
  { re: /\b(دعني أفكر|خلني أفكر|هفكر في|خطوات التفكير|عملية التفكير|طيب هكتب|المستخدم عايز|المستخدم طلب)\b/i, label: 'reasoning_narration_ar' },
];

/** Runs BEFORE Quality Control. Deterministic — never relies on the AI QC
 * pass alone. A single isolated metadata marker (e.g. one stray "Status:"
 * line) is stripped and the content is kept ("cleaned"). Heavy leakage
 * (multiple distinct markers, or metadata making up a large share of the
 * text) can't be safely fixed by deleting a line or two, so the caller is
 * told to regenerate instead of publishing a silently-edited post. */
export function sanitizeGeneratedContent(raw: string): { content: string; action: 'ok' | 'cleaned' | 'regenerate'; reasons: string[] } {
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

  const cleaned = lines
    .filter((line) => !METADATA_PATTERNS.some((p) => p.re.test(line)))
    .join('\n')
    .replace(/```[a-z]*/gi, '')
    .trim();

  if (!cleaned) {
    return { content: text, action: 'regenerate', reasons: hits.map((h) => h.label) };
  }
  return { content: cleaned, action: 'cleaned', reasons: hits.map((h) => h.label) };
}

/** Illustrative examples of garbled machine-translation-style Arabic — one
 * signal among several below, never the sole detector (heuristics, not a
 * fixed blocklist, per the guard's design). */
const KNOWN_BAD_ARABIC_PATTERNS = [
  'مقاييس حماك قنينة أمان',
  'مالية وظيفتك ليست كارثة',
  'مراجعة عتبة رمادية',
  'الشكوك الوهمية',
  'إعداد وثيقة كجسر',
  'تتدحرج الأداء إلى معضلة',
];

/** Any script that is neither Arabic nor Latin (CJK, Hiragana/Katakana,
 * Hangul, Cyrillic, Devanagari, Thai, Hebrew, ...). A ratio-based check like
 * excessive_latin_mixing below is useless against a single stray non-Latin
 * character buried in an otherwise-long Arabic post (its share of the text
 * never crosses a percentage threshold) — and these characters are counted
 * by neither the Arabic nor the Latin regex, so previously they were
 * invisible to this guard entirely. Zero tolerance: legitimate Arabic
 * content never contains these scripts, so a single occurrence fails. */
const FOREIGN_SCRIPT_RE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Cyrillic}|\p{Script=Devanagari}|\p{Script=Thai}|\p{Script=Hebrew}/u;

/** A Latin-script word carrying a non-ASCII diacritic (é, ñ, ü, ã, ç, ...).
 * Same blind spot as FOREIGN_SCRIPT_RE: a single leaked French/Spanish/
 * Portuguese word (e.g. "Estratégias") is invisible to excessive_latin_mixing
 * because one word's character count never reaches 60% of a long post's
 * Arabic character count. Legitimate Egyptian-Arabic business content uses
 * plain ASCII English terms (SaaS, CRM, ROI...), never accented Latin, so
 * this is a safe zero-tolerance signal rather than a ratio.  */
const ACCENTED_LATIN_WORD_RE = /[a-zA-Z]*[àâäáãåāèéêëēìíîïīòóôöõøōùúûüūçñÿ][a-zA-Z]*/;

/** Cheap, deterministic pre-check for obviously broken Arabic — run before
 * the AI QC pass, not instead of it. Only catches clear-cut failure
 * patterns (garbled word salad, abnormal repetition, heavy Latin
 * intrusion, non-Arabic script leaks, known bad fragments, leaked system
 * labels); anything subtler is left to the AI QC agent's Arabic
 * Naturalness scoring. */
export function arabicNaturalnessGuard(text: string): { pass: boolean; reasons: string[] } {
  const trimmed = text.trim();
  const reasons: string[] = [];

  if (trimmed.length < 20) reasons.push('too_short');

  const arabicChars = (trimmed.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latinChars = (trimmed.match(/[a-zA-Z]/g) ?? []).length;
  if (arabicChars > 0 && latinChars > arabicChars * 0.6) reasons.push('excessive_latin_mixing');

  if (FOREIGN_SCRIPT_RE.test(trimmed)) reasons.push('non_arabic_script_leak');
  if (arabicChars > 0 && ACCENTED_LATIN_WORD_RE.test(trimmed)) reasons.push('accented_latin_word_leak');

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

/** The single source of truth for "is this post actually approved". Never
 * trusts the QC `score` alone: requires the Deterministic Guard to pass AND
 * QC to have parsed successfully AND every relevant sub-score to clear its
 * own minimum, regardless of the overall score or the AI's own `approved`
 * flag. This is what item 6/8 of the QC hardening pass call for — e.g.
 * arabic_quality = 55 with score = 85 must NOT be approved. Phase 2, STEP
 * 11 (section 20 — Critical Issues) adds one more absolute gate: a
 * `critical_issues` entry (factual_error/brand_violation/forbidden_term/
 * platform_violation/unsafe_content) blocks approval no matter how high
 * every score is — "لا يسمح للـcontent بالمرور حتى لو كان الـoverall score
 * مرتفعًا". */
export function evaluateContentApproval(
  content: string,
  quality: ContentQualityResult | null,
  linkedInTarget: boolean,
): { approved: boolean; reasons: string[] } {
  const guard = arabicNaturalnessGuard(content);
  const reasons: string[] = guard.pass ? [] : guard.reasons.map((r) => `guard:${r}`);

  if (!quality) {
    reasons.push('qc_unavailable');
    return { approved: false, reasons };
  }
  if (quality.critical_issues?.length) {
    reasons.push(...quality.critical_issues.map((i) => `critical:${i}`));
  }
  if (!quality.approved) reasons.push('qc_not_approved');
  if (typeof quality.score !== 'number' || quality.score < QC_MIN_SCORE) reasons.push('score_below_minimum');
  if (typeof quality.arabic_quality !== 'number') reasons.push('arabic_quality_missing');
  else if (quality.arabic_quality < QC_MIN_ARABIC_QUALITY) reasons.push('arabic_quality_below_minimum');
  if (linkedInTarget) {
    if (typeof quality.linkedin_fit !== 'number') reasons.push('linkedin_fit_missing');
    else if (quality.linkedin_fit < QC_MIN_LINKEDIN_FIT) reasons.push('linkedin_fit_below_minimum');
  }
  if (typeof quality.brand_fit !== 'number') reasons.push('brand_fit_missing');
  else if (quality.brand_fit < QC_MIN_BRAND_FIT) reasons.push('brand_fit_below_minimum');

  return { approved: guard.pass && reasons.length === 0, reasons };
}

const CRITICAL_ISSUE_LABELS: Record<string, string> = {
  factual_error: 'يحتوي على معلومة غير دقيقة تحتاج تحققًا',
  brand_violation: 'يخالف هوية البراند أو قيمه',
  forbidden_term: 'يحتوي على كلمة أو مصطلح ممنوع من Brand Voice',
  platform_violation: 'يخالف قواعد المنصة المستهدفة',
  unsafe_content: 'يحتوي على محتوى غير آمن للنشر',
};

/** Phase 2, STEP 11 (section 21) — the Quality Decision Layer. Turns a
 * single QC pass into one of APPROVE/IMPROVE/REWRITE/RESEARCH/
 * HUMAN_REVIEW/REJECT, always decided here in code — never by asking the
 * model to grade its own content, same principle as evaluateContentApproval
 * itself. This function is purely descriptive: it does not change what
 * evaluateContentApproval gates on, and by itself does not yet change any
 * pipeline behavior (that's STEP 12's Smart Rewrite / STEP 13's AI Decision
 * Layer) — it only produces the label + reasoning the caller can act on. */
export function computeQualityDecision(
  content: string,
  quality: ContentQualityResult | null,
  linkedInTarget: boolean,
): QualityDecision {
  const { approved, reasons } = evaluateContentApproval(content, quality, linkedInTarget);
  const guard = arabicNaturalnessGuard(content);
  const criticalIssues = quality?.critical_issues ?? [];

  if (criticalIssues.length > 0) {
    return {
      decision: 'REJECT',
      reason: criticalIssues.map((i) => CRITICAL_ISSUE_LABELS[i] ?? i).join('؛ '),
      confidence: 0.95,
      issues: criticalIssues,
      recommendations: ['أصلح أو احذف العناصر المحظورة المذكورة قبل إعادة المحاولة — لا يمكن الموافقة على هذا المحتوى بصيغته الحالية.'],
    };
  }

  if (!quality) {
    return {
      decision: 'HUMAN_REVIEW',
      reason: 'تعذّر تشغيل Quality Control لهذا المحتوى (خطأ شبكة أو استجابة غير صالحة).',
      confidence: 0.3,
      issues: ['qc_unavailable'],
      recommendations: ['راجع المحتوى يدويًا قبل الاعتماد — لا تتوفر درجة جودة موثوقة.'],
    };
  }

  if (approved) {
    return {
      decision: 'APPROVE',
      reason: 'اجتاز المحتوى كل معايير الجودة المطلوبة بدون أي Critical Issue.',
      confidence: Math.min(1, quality.score / 100),
      issues: [],
      recommendations: [],
    };
  }

  if (!guard.pass) {
    return {
      decision: 'REWRITE',
      reason: 'المحتوى به مشكلة جوهرية في الصياغة أو اللغة (يفشل الـDeterministic Guard) — تعديل جزئي لن يكفي.',
      confidence: 0.8,
      issues: reasons,
      recommendations: quality.suggestions.length ? quality.suggestions : ['أعد كتابة المحتوى من الصفر بلهجة طبيعية.'],
    };
  }

  if (typeof quality.factual_score === 'number' && quality.factual_score < 60) {
    return {
      decision: 'RESEARCH',
      reason: 'موثوقية المعلومات الواردة في المحتوى منخفضة — يحتاج تأكيدًا من مصدر حقيقي قبل النشر.',
      confidence: 0.7,
      issues: [...reasons, 'factual_score_below_minimum'],
      recommendations: ['مرّر المحتوى على Research Agent لتأكيد أي أرقام أو حقائق مذكورة.'],
    };
  }

  if (quality.score < 50) {
    return {
      decision: 'REWRITE',
      reason: 'الدرجة الإجمالية منخفضة جدًا لدرجة أن تعديلات جزئية لن ترفعها لمستوى مقبول.',
      confidence: 0.8,
      issues: reasons,
      recommendations: quality.suggestions.length ? quality.suggestions : ['أعد كتابة المحتوى بالكامل مع مراعاة الملاحظات.'],
    };
  }

  return {
    decision: 'IMPROVE',
    reason: 'المحتوى قريب من مستوى القبول لكنه يحتاج تعديلات محددة قبل الموافقة.',
    confidence: 0.6,
    issues: reasons,
    recommendations: quality.suggestions.length ? quality.suggestions : ['عالج الملاحظات المذكورة أعلاه ثم أعد المراجعة.'],
  };
}

/** Final gate before createPost() — combines the sanitizer and the Arabic
 * Naturalness Guard into one valid/invalid verdict on the exact text about
 * to be saved as `posts.content`. This runs even on manually-edited drafts
 * (the QC agent may not have re-run against the user's edit), so it never
 * depends on `quality` being present. */
export function validateFinalPostContent(content: string): { valid: boolean; reasons: string[] } {
  const trimmed = content.trim();
  const reasons: string[] = [];
  if (!trimmed) reasons.push('empty_content');

  const sanitized = sanitizeGeneratedContent(trimmed);
  if (sanitized.action !== 'ok') reasons.push(...sanitized.reasons.map((r) => `metadata:${r}`));

  const guard = arabicNaturalnessGuard(trimmed);
  if (!guard.pass) reasons.push(...guard.reasons);

  return { valid: reasons.length === 0, reasons };
}
