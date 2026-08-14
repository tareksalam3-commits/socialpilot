import type { ContentQualityResult, QualityDecision, QualityDimensionKey } from '@/types/assistant';
import { CRITICAL_QUALITY_DIMENSIONS } from '@/types/assistant';

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

/** QC Hardening Pass — the Critical Dimension Gate (brief item 3). Every
 * dimension in CRITICAL_QUALITY_DIMENSIONS (types/assistant.ts) must clear
 * this same 90 floor on its own, independently of the overall `score`
 * average — this is what stops "95+95+95+60" style masking, where a single
 * weak-but-critical dimension used to get diluted into a passing overall
 * number. Non-critical dimensions (substance, structure, audience_fit, cta,
 * originality, factual_logical) still count toward the overall average via
 * `score`, but don't individually block approval the way a critical one
 * does — a mediocre-but-not-disqualifying CTA shouldn't sink an otherwise
 * excellent post, whereas a weak idea, hook, brand fit, or broken Arabic
 * should. */
export const QC_MIN_CRITICAL_DIMENSION = 90;

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

/** QC Hardening Pass (brief item 4/5) — the most common generic/cliché
 * openers that Arabic content-generation tends to default to when it has
 * nothing specific to say. A single deterministic backstop signal, never
 * the sole detector of "generic content" (the QC model's `idea_value` and
 * `substance` dimensions cover the general case) — this only catches the
 * handful of stock openers common enough to hardcode, so a post can't slip
 * through purely because the QC model happened to score it generously. */
const CLICHE_OPENER_PATTERNS = [
  /^\s*في عالم(نا)?\s+(اليوم|الحالي)/,
  /^\s*في ظل\s+(التطورات|التحديات|الظروف)\s+المتسارعة/,
  /^\s*لا شك أن/,
  /^\s*بدون أدنى شك/,
  /^\s*من المهم جدًا أن ندرك/,
  /^\s*في عصر\s+(التكنولوجيا|السرعة|المعلومات)/,
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

  // A single generated post must never be a bare topic/idea line (e.g. "5
  // طرق لتحفيز الفريق") or a numbered list of multiple post ideas (e.g.
  // "منشور 1: ... منشور 2: ..." / "Post 1: ..."). Either pattern means the
  // model answered "give me post ideas" instead of writing one ready-to-
  // publish post, and must be caught here rather than silently approved —
  // this is exactly the failure mode a weak/free-tier model tends toward.
  if (/(?:^|\n)\s*(?:منشور|post)\s*\d+\s*[:：]/i.test(trimmed)) reasons.push('idea_list_not_post');
  const sentenceEnders = (trimmed.match(/[.!؟?]/g) ?? []).length;
  const lineCount = trimmed.split('\n').filter((l) => l.trim().length > 0).length;
  if (trimmed.length < 150 && lineCount <= 1 && sentenceEnders <= 1 && !/#\S/.test(trimmed)) {
    reasons.push('likely_title_only');
  }

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

/** The single source of truth for "is this post actually approved". Never
 * trusts the QC model's own `approved`/`score` self-report: every decision
 * here is recomputed purely from the Deterministic Guard + the per-
 * dimension scores in `quality.dimensions` (or, for any older/legacy result
 * missing `dimensions`, the flat scores it does have) + `critical_issues`.
 *
 * QC Hardening Pass — the Critical Dimension Gate (brief item 3): every
 * dimension in CRITICAL_QUALITY_DIMENSIONS must independently clear
 * QC_MIN_CRITICAL_DIMENSION, on top of the overall `score` (the mean of all
 * twelve dimensions, computed in qualityControl.ts) clearing QC_MIN_SCORE.
 * This is exactly what stops "95+95+95+60" from averaging into a pass: a
 * single weak critical dimension fails approval outright, regardless of how
 * high the mean or any other dimension is. Item 6/8 example — arabic_quality
 * = 55 with score = 85 must NOT be approved — falls directly out of this:
 * arabic_quality is critical, 55 < 90, so it fails on its own, and 85 < 90
 * fails the overall floor too. `critical_issues` (section 20) is one more
 * absolute gate on top: any entry blocks approval no matter how high every
 * score is. */
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
  if (typeof quality.score !== 'number' || quality.score < QC_MIN_SCORE) reasons.push('score_below_minimum');

  // Critical Dimension Gate — each of the six critical dimensions is
  // checked independently, preferring the structured `dimensions` record
  // when present and falling back to the legacy flat field for any older
  // cached QC result that predates the QC Hardening Pass.
  for (const dim of CRITICAL_QUALITY_DIMENSIONS) {
    const value = criticalDimensionScore(quality, dim, linkedInTarget);
    if (dim === 'platform_fit' && !linkedInTarget) {
      // platform_fit still counts toward the overall mean for non-LinkedIn
      // targets, but only gates individually when we actually have a
      // platform-specific bar to hold it to (LinkedIn today).
      continue;
    }
    if (value === undefined) reasons.push(`${dim}_missing`);
    else if (value < QC_MIN_CRITICAL_DIMENSION) reasons.push(`${dim}_below_minimum`);
  }

  return { approved: guard.pass && reasons.length === 0, reasons };
}

/** Reads one critical dimension's score, preferring the structured
 * `dimensions` record and falling back to the pre-Hardening-Pass flat
 * fields so old cached QC results (or a QC call that for some reason
 * omitted `dimensions`) still gate correctly instead of silently passing. */
function criticalDimensionScore(quality: ContentQualityResult, dim: QualityDimensionKey, linkedInTarget: boolean): number | undefined {
  const fromDimensions = quality.dimensions?.[dim]?.score;
  if (typeof fromDimensions === 'number') return fromDimensions;
  switch (dim) {
    case 'idea_value':
      return quality.content_value_score;
    case 'hook':
      return quality.hook_score;
    case 'arabic_quality':
      return quality.arabic_quality;
    case 'naturalness':
      return quality.naturalness_score;
    case 'brand_fit':
      return quality.brand_fit ?? quality.brand_score;
    case 'platform_fit':
      return linkedInTarget ? quality.linkedin_fit ?? quality.platform_score : quality.platform_score;
    default:
      return undefined;
  }
}

const CRITICAL_ISSUE_LABELS: Record<string, string> = {
  factual_error: 'يحتوي على معلومة غير دقيقة تحتاج تحققًا',
  brand_violation: 'يخالف هوية البراند أو قيمه',
  forbidden_term: 'يحتوي على كلمة أو مصطلح ممنوع من Brand Voice',
  platform_violation: 'يخالف قواعد المنصة المستهدفة',
  unsafe_content: 'يحتوي على محتوى غير آمن للنشر',
  generic_content: 'محتوى عام بدون قيمة حقيقية',
  unnatural_cta: 'CTA تسويقي مصطنع لا علاقة حقيقية له بالموضوع',
  ai_generated_style: 'يبدو نصًا آليًا/AI-generated وليس منشورًا شخصيًا طبيعيًا',
  length_mismatch: 'طول المنشور غير مناسب لهدفه أو منصته',
  obvious_repetition: 'تكرار واضح لنفس الفكرة أو الـHook أو الـCTA',
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
