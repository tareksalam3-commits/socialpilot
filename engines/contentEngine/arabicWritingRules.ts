import { DIALECTS, DEFAULT_DIALECT, type DialectCode } from '@/constants/dialects';

/** True when any of the given platform ids is LinkedIn (personal profile or
 * company page) — used to switch on the LinkedIn Writing Profile rules. */
export function isLinkedInPlatform(platforms: string[]): boolean {
  return platforms.some((p) => p === 'linkedin' || p === 'linkedin_page' || p.includes('linkedin'));
}

/** Mandatory Egyptian Arabic Native Writing Engine rules — the "Rewrite in
 * Professional Egyptian Arabic" stage of the pipeline:
 *   Extract Source → Understand & Summarize → Rewrite in Professional
 *   Egyptian Arabic → Content Quality Check → Final Content.
 * Applied to every post regardless of platform or where the text originated
 * (a user prompt, or grounding material pulled from Content Sources). The
 * language bar is explicit and non-negotiable: whenever the final content is
 * Arabic, it must be "عربية مصرية مهنية طبيعية" (natural, professional
 * Egyptian Arabic) — never Modern Standard Arabic (فصحى), never heavy formal
 * Arabic, never a literal/word-for-word translation, and never a different
 * Arabic dialect (Gulf, Levantine, Maghrebi, etc). Word-for-word swapping of
 * Fus-ha vocabulary for Egyptian equivalents is explicitly banned — the
 * model must rewrite the whole sentence as if an Egyptian professional wrote
 * it from scratch. Exported so the Content Sources authoring path (RSS/Web/
 * YouTube/PDF/Word/Excel → generated post) applies the exact same rules the
 * Creator agent does, instead of a bare, dialect-unaware prompt. */
/** Builds the "Rewrite in Professional <Dialect> Arabic" system prompt for
 * any resolved dialect — the Egyptian text is the system's quality
 * reference (see module docstring above), and every other dialect gets the
 * exact same structure and bar, just with its own name/demonym/examples
 * swapped in via DIALECTS. Word-for-word Fus-ha→dialect vocabulary swapping
 * is banned for every dialect, not just Egyptian: the model must rewrite
 * the whole sentence as if a professional native speaker of that dialect
 * wrote it from scratch. */
export function buildArabicWritingRules(dialect: DialectCode = DEFAULT_DIALECT): string {
  const meta = DIALECTS[dialect] ?? DIALECTS[DEFAULT_DIALECT];
  return `قواعد الكتابة الإلزامية — اللهجة العربية المطلوبة: ${meta.name} (${meta.code}):
- أعد صياغة الجملة بالكامل كما لو كتبها متحدث ${meta.name} محترف من الصفر — ممنوع استبدال كلمات الفصحى بمرادفات ${meta.name.replace(/^ال/, '')} فقط مع إبقاء تركيب الجملة فصيحًا.
- ممنوع منعًا باتًا: الفصحى، العربية الرسمية الثقيلة، الترجمة الحرفية/الآلية، أو أي لهجة عربية غير ${meta.name}.
- استخدم مفردات وتراكيب ${meta.name} الطبيعية في الحياة المهنية اليومية، مع الحفاظ على لغة مهنية راقية (وليست عامية سوقية).
- النتيجة يجب أن تبدو كأنها مكتوبة بشكل أصلي بلهجة ${meta.name}، وليست ترجمة أو تحويلًا من نص آخر.`;
}

export const EGYPTIAN_ARABIC_WRITING_RULES = buildArabicWritingRules('egyptian');

/** LinkedIn Writing Profile — applied on top of (never instead of) Brand
 * Voice and the Arabic writing rules above when the post targets LinkedIn
 * (linkedin / linkedin_page). */
export const LINKEDIN_WRITING_RULES = `قواعد إضافية خاصة بمنصة LinkedIn (التزم بها بالكامل):
- Hook قوي وجذاب في أول سطر — لا تبدأ بمقدمة عامة أو تمهيد.
- لا تستخدم صيغة "هل سبق لك أن..." إلا إذا كان السؤال قويًا وذكيًا فعلًا.
- فقرات قصيرة مع مساحات بيضاء بين الأسطر.
- فكرة واحدة واضحة لكل منشور.
- قدّم Insight حقيقي وليس كلامًا عامًا.
- لغة مهنية، وليست لغة إعلانية أو تسويقية.
- لا تجعل المنشور يبدو وكأنه إعلان لشركة.
- ممنوع الوعود التسويقية والمبالغات.
- ممنوع استخدام CTA تقليدي مثل "تواصل معي لمعرفة المزيد".
- اجعل نهاية المنشور تفتح مساحة للنقاش.
- من 4 إلى 6 Hashtags كحد أقصى، ولا تكرر نفس الكلمة بشكل مزعج.
- لا تستخدم Emoji إلا إذا كان Brand Voice يسمح بذلك صراحة.
- الطول الافتراضي للمنشور بين 120 و180 كلمة.`;

/** Strict output contract appended to the Creator prompt. This is a hard
 * requirement (not a style suggestion): the model must return nothing but
 * the finished post — no preview/publishing/QC metadata of any kind. This
 * is the first line of defense; sanitizeGeneratedContent() and
 * arabicNaturalnessGuard() (in contentGuards.ts) are the deterministic
 * backstops in case the model doesn't fully comply. */
export const OUTPUT_CONTRACT = `OUTPUT CONTRACT (mandatory, overrides everything else):
Return ONLY the final social media post. Nothing else.

The output MUST NOT contain any of the following, in any language:
- "Preview"
- "Platform" / "Platform:"
- "Account" / "Account:"
- "Scheduled Time" / "Scheduled"
- "Status" / "Status:"
- "Awaiting Confirmation"
- "Content Score" / "Quality Score"
- "Notes" / "Explanation" / "Labels"
- "Final Post"
- Markdown code fences (\`\`\`)

The first character of the response must be the first character of the actual post.
The last character of the response must be the last character of the actual post (its final word, punctuation, or hashtag) — never a label, score, or trailing note.`;
