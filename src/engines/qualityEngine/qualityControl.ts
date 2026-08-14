import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import type { ChatMessage, BrandVoice } from '@/types/ai';
import type { ContentQualityResult, QualityDimensionKey, QualityDimensionResult } from '@/types/assistant';
import { CRITICAL_QUALITY_DIMENSIONS } from '@/types/assistant';
import { DIALECTS, DEFAULT_DIALECT, type DialectCode } from '@/constants/dialects';
import { stripFence, sanitizeGeneratedContent, evaluateContentApproval, computeQualityDecision } from '../contentEngine/contentGuards';
import { isLinkedInPlatform } from '../contentEngine/arabicWritingRules';

/** Max regeneration attempts any Quality-Control loop gets before the
 * best-scoring candidate is kept and surfaced as "Needs Manual Review".
 * Shared by every entry point that authors post content (AI Assistant,
 * Content Sources) so the quality bar is identical everywhere. */
export const MAX_QC_ATTEMPTS = 3;

function clampScore(n: unknown): number {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.min(100, Math.max(0, Math.round(num)));
}

/** QC Hardening Pass — the restricted, structured-output-only set of
 * critical-issue labels the QC model may report. Expanded beyond the
 * original five (factual_error/brand_violation/forbidden_term/
 * platform_violation/unsafe_content) to also give the model a way to flag
 * item 5's remaining Hard Fail Rules that aren't already covered by a
 * dimension-score gate: content that is technically fine dimension-by-
 * dimension but is still generic filler, has a fabricated/marketing-speak
 * CTA, unmistakably reads as raw AI output, is a wildly wrong length for
 * its stated goal, or repeats the same hook/idea/CTA in an obvious pattern.
 * Never free-form text a downstream decision would have to
 * parse — the model can only pick from this list. */
const CRITICAL_ISSUE_KEYS = [
  'factual_error',
  'brand_violation',
  'forbidden_term',
  'platform_violation',
  'unsafe_content',
  'generic_content',
  'unnatural_cta',
  'ai_generated_style',
  'length_mismatch',
  'obvious_repetition',
] as const;

/** All twelve dimensions (A-L) the QC model is required to score. Order
 * matches the brief exactly and is reused for prompt-building, parsing, and
 * the deterministic mean-score calculation, so nothing here can silently
 * drift out of sync. */
const QUALITY_DIMENSION_KEYS: readonly QualityDimensionKey[] = [
  'idea_value',
  'hook',
  'substance',
  'structure',
  'arabic_quality',
  'naturalness',
  'brand_fit',
  'audience_fit',
  'platform_fit',
  'cta',
  'originality',
  'factual_logical',
];

/** Maps each dimension's parsed result onto the legacy flat fields so
 * existing UI (AIAssistantPage.tsx etc.) keeps reading real, current values
 * without needing to change. Never the other direction — `dimensions` is
 * always the source of truth these are derived FROM, never derived from. */
function projectDimensionsToFlatFields(dimensions: Partial<Record<QualityDimensionKey, QualityDimensionResult>>): Partial<ContentQualityResult> {
  const s = (k: QualityDimensionKey): number | undefined => dimensions[k]?.score;
  return {
    content_value_score: s('idea_value'),
    hook_score: s('hook'),
    substance_score: s('substance'),
    structure_score: s('structure'),
    arabic_quality: s('arabic_quality'),
    naturalness_score: s('naturalness'),
    brand_fit: s('brand_fit'),
    brand_score: s('brand_fit'),
    audience_fit_score: s('audience_fit'),
    relevance_score: s('audience_fit'),
    platform_score: s('platform_fit'),
    linkedin_fit: s('platform_fit'),
    language_score: s('arabic_quality'),
    cta_score: s('cta'),
    originality_score: s('originality'),
    factual_score: s('factual_logical'),
    clarity_score: s('structure'),
    readability_score: s('structure'),
  };
}

/** Parses one dimension entry out of the QC model's `dimensions` object.
 * Never trusts the model's own `status` in isolation — `status` is kept for
 * the evidence record shown to humans/the Rewrite Agent, but every gating
 * decision downstream (evaluateContentApproval) recomputes pass/fail from
 * `score` against that dimension's own threshold in code. Missing/malformed
 * fields fall back to a failing 0/"missing" entry rather than being dropped
 * silently — an evaluator that can't score a dimension must never be read
 * as "this dimension is fine". */
function parseDimension(raw: unknown): QualityDimensionResult {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const score = obj.score === undefined ? 0 : clampScore(obj.score);
  return {
    score,
    status: obj.status === 'pass' || obj.status === 'fail' ? obj.status : score >= 90 ? 'pass' : 'fail',
    reason: typeof obj.reason === 'string' ? obj.reason : '',
    evidence: typeof obj.evidence === 'string' ? obj.evidence : '',
    suggested_fix: typeof obj.suggested_fix === 'string' ? obj.suggested_fix : '',
  };
}

/** Parses the strict-JSON response the QC model is instructed to return.
 * Returns null (never throws) on anything that isn't valid — the caller
 * treats that as "QC unavailable" rather than blocking the pipeline.
 *
 * QC Hardening Pass: `score` in the returned result is NEVER the model's
 * self-reported overall number — it is always recomputed here as the mean
 * of the twelve `dimensions` scores. This is what item 1/3 of the brief
 * require: a model that reports "95+95+95+60" can no longer have that low
 * 60 averaged away by its own arithmetic, because its own arithmetic is
 * never used. Any dimension missing from the response scores 0 in this
 * mean (see parseDimension) — QC can't silently skip scoring something
 * inconvenient and have that read as a pass. `approved` from the model is
 * discarded entirely; only evaluateContentApproval (contentGuards.ts),
 * reading `dimensions`, ever decides approval. */
function parseQCResult(raw: string): ContentQualityResult | null {
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    const rawDimensions = (json.dimensions && typeof json.dimensions === 'object' ? json.dimensions : {}) as Record<string, unknown>;
    const dimensions: Partial<Record<QualityDimensionKey, QualityDimensionResult>> = {};
    for (const key of QUALITY_DIMENSION_KEYS) {
      dimensions[key] = parseDimension(rawDimensions[key]);
    }
    const score = clampScore(QUALITY_DIMENSION_KEYS.reduce((sum, k) => sum + (dimensions[k]?.score ?? 0), 0) / QUALITY_DIMENSION_KEYS.length);

    const issues = Array.isArray(json.issues) ? (json.issues as unknown[]).filter((i): i is string => typeof i === 'string') : [];
    const suggestions = Array.isArray(json.suggestions)
      ? (json.suggestions as unknown[]).filter((i): i is string => typeof i === 'string')
      : [];

    const result: ContentQualityResult = {
      // Placeholder — evaluateContentApproval (contentGuards.ts) always
      // recomputes this from `dimensions`; never read from the model.
      approved: false,
      score,
      issues,
      suggestions,
      dimensions,
      ...projectDimensionsToFlatFields(dimensions),
    };

    if (Array.isArray(json.critical_issues)) {
      const critical = (json.critical_issues as unknown[]).filter(
        (i): i is string => typeof i === 'string' && (CRITICAL_ISSUE_KEYS as readonly string[]).includes(i),
      );
      if (critical.length) result.critical_issues = critical;
    }
    return result;
  } catch {
    return null;
  }
}

/** Builds the Arabic Content Quality Control agent's prompt. Must respond
 * with strict JSON only — same contract as the Planner. This is a second,
 * independent layer on top of the Creator prompt (never a substitute for
 * it): the Creator is instructed to write naturally, and QC independently
 * verifies that it actually did, catching machine-translation-like phrasing
 * the Creator prompt alone didn't prevent.
 *
 * QC Hardening Pass (item 4/7 of the brief): the model is explicitly framed
 * as adversarial — told to hunt for the specific defects that make content
 * mediocre (filler, repetition, AI-sounding phrasing, weak hooks, hollow
 * CTAs, clichés, illogical transitions, empty "takeaway") rather than asked
 * a soft "rate this" question — and required to back every dimension with
 * concrete evidence + a suggested fix, not just a number. */
function buildQCMessages(
  content: string,
  platforms: string[],
  originalRequest: string | null | undefined,
  brandVoice: BrandVoice | null,
  dialect: DialectCode = DEFAULT_DIALECT,
): ChatMessage[] {
  const linkedInTarget = isLinkedInPlatform(platforms);
  const negativeKeywords = brandVoice?.negative_keywords?.length ? brandVoice.negative_keywords.join(', ') : 'لا يوجد';
  const meta = DIALECTS[dialect] ?? DIALECTS[DEFAULT_DIALECT];
  const otherDialectNames = Object.values(DIALECTS)
    .filter((d) => d.code !== meta.code)
    .map((d) => d.name)
    .join('، ');
  const criticalNames = CRITICAL_QUALITY_DIMENSIONS.join(', ');

  return [
    {
      role: 'system',
      content: `أنت "Arabic Content Quality Control" — مراقب جودة محتوى عربي متخصص في منشورات LinkedIn وPersonal Branding. دورك عدائي/نقدي (Adversarial) بالكامل — أنت لست هنا لتوافق على المحتوى، أنت هنا لتجد كل سبب يجعله غير جاهز للنشر. لا تسأل نفسك "هل هذا جيد؟" — اسأل نفسك "ما الذي يجعل هذا المنشور أضعف من منشور احترافي حقيقي؟". ابحث تحديدًا عن: كلام عام لا يقول شيئًا فعليًا، حشو، تكرار لنفس الفكرة بصياغات مختلفة، صياغة تشبه الترجمة الآلية أو أسلوب روبوتي، Hook ضعيف أو منفصل عن باقي النص، CTA مصطنع أو تسويقي بلا علاقة حقيقية بالموضوع، نصائح بديهية لا تضيف قيمة، انتقالات غير منطقية بين الأفكار، مبالغة أو وعود غير مبررة، clichés مستهلكة، عدم وجود takeaway حقيقي يقدر القارئ يطبقه، وعدم ملاءمة النص فعليًا للمنصة أو للجمهور المستهدف (وليس فقط نفس النص المعاد استخدامه لكل منصة). إذا وجدت أي عيب حقيقي من هذه يجب أن تخفض درجة البُعد المرتبط به بوضوح — لا تتساهل، ولا "تقرّب" الدرجة لأعلى.

راجع النص المرفق بموضوعية صارمة وأرجع JSON فقط، بدون أي شرح أو Markdown أو نص إضافي قبله أو بعده.

قيّم النص على الاثني عشر بُعدًا التالية (كل بُعد بدرجة مستقلة من 0 إلى 100، ولكل بُعد status: "pass" أو "fail"، وreason (سبب مختصر)، وevidence (اقتباس أو وصف دقيق للمشكلة الفعلية في النص نفسه — أو "لا توجد مشكلة" إن كان pass)، وsuggested_fix (ما الذي يجب تغييره تحديدًا؛ فارغ إن كان pass)):

A. idea_value — الفكرة والقيمة: هل يقدم المنشور فكرة واضحة ومفيدة فعلًا للقارئ، أم كلام عام يمكن أن يُكتب عن أي موضوع؟
B. hook — Hook: هل أول 1-2 سطر يخلقان فضولًا أو توترًا حقيقيًا يجعل القارئ يريد الاستمرار، أم بداية عامة/مملة؟
C. substance — جودة المحتوى (Substance): هل يوجد مضمون حقيقي (مثال، رقم، تجربة، رأي محدد) أم حشو وعبارات عامة مكررة بصياغات مختلفة؟
D. structure — البنية: هل المنشور منظم، فقراته منطقية، وسهل القراءة على الموبايل، أم كتلة نص غير منظمة؟
E. arabic_quality — Arabic Naturalness (اللهجة المطلوبة: ${meta.name}) — هل هو "عربية ${meta.name} مهنية طبيعية" فعلًا (وليس فصحى، ولا عربية رسمية ثقيلة، ولا ترجمة حرفية/آلية، ولا لهجة عربية أخرى مثل ${otherDialectNames})؟ راجع أن الصياغة مُعاد بناؤها بالكامل بلهجة ${meta.name} وليست فصحى تم فيها استبدال كلمات بمرادفات ${meta.name.replace(/^ال/, '')} فقط.
F. naturalness — الطبيعية (مستقلة عن E): هل يبدو النص كأنه مكتوب بواسطة شخص محترف حقيقي بنبرة إنسانية، أم يبدو كنص آلي/AI-generated حتى لو كانت قواعد اللغة سليمة (جمل متكاملة الشكل لكن بلا شخصية أو رأي حقيقي، انتقالات صناعية، توازن مصطنع بين الجمل)؟
G. brand_fit — Brand Voice Alignment: مدى الالتزام بهوية العلامة ونبرتها المذكورة (وليس مجرد عدم مخالفتها).
H. audience_fit — ملاءمة الجمهور: هل يخاطب النص الجمهور المحدد فعليًا (مستواه، همومه، اهتماماته) أم نص عام يصلح لأي جمهور؟
I. platform_fit — ملاءمة المنصة: هل النص مكتوب فعلًا لمنصته المستهدفة (${platforms.join(' + ') || 'غير محدد'}) بأسلوبها وطولها وقواعدها، أم نفس النص المستخدم لمنصة أخرى بدون تكييف حقيقي؟${linkedInTarget ? ' لـLinkedIn تحديدًا: Hook قوي، فقرات قصيرة، لا CTA تقليدي، 4 إلى 6 هاشتاجات كحد أقصى، بدون Emoji إلا إذا سمح Brand Voice.' : ''}
J. cta — جودة الدعوة لإجراء: هل الـCTA طبيعي ومرتبط فعليًا بموضوع المنشور، أم جملة تسويقية مصطنعة (مثل "شاركنا رأيك في الكومنتات" بدون أي سبب حقيقي مرتبط بالمحتوى)؟
K. originality — التفرد: هل الـHook أو الفكرة أو الـCTA معاد تدويرها من نمط مكرر شائع، أم لها زاوية أو صياغة مميزة؟
L. factual_logical — السلامة الواقعية والمنطقية: هل توجد ادعاءات غير منطقية، وعود غير مبررة، معلومات مختلقة، أو أرقام/حقائق لا يمكن التحقق منها بدون سياق؟ (100 لو لا توجد ادعاءات واقعية تحتاج تحققًا أصلًا ومنطق النص سليم).

الأبعاد الحرجة (Critical Dimensions) هي: ${criticalNames}. أي بُعد من هذه يسجل أقل من 90 يعني أن هذا المحتوى يجب أن يفشل (fail) بغض النظر عن باقي الدرجات — لا تسمح لمتوسط الدرجات بإخفاء ضعف بُعد حرج واحد. مثال: منشور بدرجات 95, 95, 95 في ثلاثة أبعاد لكن hook = 60 يجب أن يُسجَّل hook.status = "fail" بوضوح ولا يجوز التساهل معه لأن باقي الأبعاد مرتفعة.

Critical Issues (قائمة critical_issues) — أضف أي من هذه القيم فقط (بنفس الأسماء بالإنجليزية بالضبط) لو انطبقت، وإلا اترك المصفوفة فارغة. لا تخترع تصنيفات أخرى:
- "factual_error": معلومة أو رقم خاطئ بشكل واضح.
- "brand_violation": يخالف قيم أو هوية البراند المذكورة.
- "forbidden_term": يحتوي على كلمة من الكلمات الممنوعة أدناه.
- "platform_violation": يخالف قاعدة إلزامية للمنصة المستهدفة (مثل تجاوز حد الهاشتاجات في LinkedIn).
- "unsafe_content": محتوى غير آمن للنشر (تحريضي، مضلل بشكل خطير، أو غير لائق).
- "generic_content": كلام عام بدون قيمة حقيقية — حتى لو كانت الدرجات الفردية غير منخفضة جدًا.
- "unnatural_cta": CTA تسويقي مصطنع لا علاقة حقيقية له بالموضوع.
- "ai_generated_style": يبدو بوضوح نصًا آليًا/AI-generated وليس منشورًا شخصيًا طبيعيًا.
- "length_mismatch": طول المنشور غير مناسب إطلاقًا لهدفه أو منصته (قصير جدًا أو طويل بشكل مفرط).
- "obvious_repetition": تكرار واضح لنفس الفكرة أو الـHook أو الـCTA — سواء داخل هذا المنشور نفسه أو كنمط متكرر يعيد نفس الزاوية بصياغة مختلفة فقط.
أي عنصر في critical_issues يعني أن هذا المحتوى لا يجوز اعتماده مهما كانت باقي الدرجات مرتفعة.

كلمات ممنوعة من Brand Voice (negative_keywords) يجب ألا تظهر في النص إطلاقًا: ${negativeKeywords}

قواعد رفض إلزامية (Hard Fail Rules) — سجّل الأبعاد المرتبطة كـ"fail" وأضف critical_issue مناسبًا إذا كان النص:
- غير مفهوم لقارئ عربي طبيعي، أو يحتاج إعادة قراءة لفهم المقصود.
- يحتوي على ما يبدو ترجمة آلية واضحة (تركيب جمل غير عربي، أو اختيار كلمات غريبة عن السياق).
- يحتوي على أي كلمة أو حرف واحد من لغة غير العربية أو الإنجليزية (فرنساوي، إسباني، برتغالي، صيني، أو أي خط/script آخر) — حتى لو كانت كلمة واحدة فقط وسط جملة عربية سليمة تمامًا. اجعل arabic_quality.score منخفضًا جدًا (أقل من 50) في هذه الحالة تحديدًا، بغض النظر عن باقي جودة النص. المصطلحات الإنجليزية التقنية الشائعة (SaaS، CRM، ROI...) مقبولة فقط لو مكتوبة بحروف إنجليزية عادية بدون علامات تشكيل من لغات أخرى.
- مكتوب بالفصحى أو بعربية رسمية ثقيلة بدل لهجة ${meta.name} المهنية المطلوبة.
- مكتوب بلهجة عربية غير ${meta.name} (${otherDialectNames}) أو خليط لهجات.
- فصحى تم فيها استبدال بعض الكلمات بمرادفات ${meta.name.replace(/^ال/, '')} فقط دون إعادة صياغة الجملة كاملة بأسلوب طبيعي بلهجة ${meta.name}.
- يبدأ بـHook غير منطقي أو لا علاقة له بموضوع المنشور، أو Hook عام لا يخلق أي فضول.
- يستخدم كلمات عربية صحيحة لغويًا لكنها خارج سياقها الطبيعي في هذا الموضوع.
- يبدو كتركيب عشوائي من كلمات عربية متفرقة بلا رابط منطقي بينها.
- يحتوي على أي معلومات UI أو تشغيلية (مثل Preview، Platform، Account، Scheduled، Status، Awaiting Confirmation، Content Score، Quality Score).
- يبدو كإعلان مولّد آليًا بدل منشور شخصي طبيعي.
- محتوى عام يمكن أن يُنشر عن أي موضوع أو أي براند بدون تغيير — بدون substance حقيقي.
- CTA لا علاقة حقيقية له بموضوع المنشور، أو صيغة مكررة بلا سبب واضح.

مهم جدًا — لا تثق في متوسط الدرجات: الدرجة الإجمالية (score) تُحسب في الكود من متوسط الأبعاد الاثني عشر، وليس من رقم تختاره أنت — لذلك لا تحاول "تعويض" بُعد ضعيف برفع بُعد آخر، فقط قيّم كل بُعد بأمانة ومستقلًا عن الباقي. وبالمثل، حقل approved الذي ترجعه لا يُستخدم في أي قرار — القرار النهائي يُحسب بالكامل من درجات الأبعاد وcritical_issues في الكود، فلا داعي "لمجاملة" النص برفع approved. اكتب score وapproved بأفضل تقدير لك للاتساق فقط.

أرجع JSON فقط بهذا الشكل بالضبط (بدون أي نص آخر)، مع كائن dimensions يحتوي بالضبط على المفاتيح الاثني عشر التالية:
{"score": number, "approved": boolean, "issues": string[], "suggestions": string[], "critical_issues": string[], "dimensions": {"idea_value": {"score": number, "status": "pass"|"fail", "reason": string, "evidence": string, "suggested_fix": string}, "hook": {...}, "substance": {...}, "structure": {...}, "arabic_quality": {...}, "naturalness": {...}, "brand_fit": {...}, "audience_fit": {...}, "platform_fit": {...}, "cta": {...}, "originality": {...}, "factual_logical": {...}}}`,
    },
    {
      role: 'user',
      content: `${originalRequest ? `طلب المستخدم الأصلي: "${originalRequest}"\n\n` : ''}النص المطلوب مراجعته:\n"""\n${content}\n"""`,
    },
  ];
}

/** Runs the Arabic Content Quality Control step. Sends the generated post to
 * the AI Gateway (same edge function/provider chain as everything else) and
 * asks for a strict-JSON verdict. Never throws: on any failure (network,
 * parsing) it returns `result: null` so the caller can treat QC as
 * unavailable for this attempt rather than blocking the whole pipeline. */
export async function reviewGeneratedContent(
  workspaceId: string,
  content: string,
  platforms: string[],
  originalRequest?: string | null,
  // `model` here should be the dedicated QC model (ai_settings.qc_model),
  // never the model that authored `content` — see `excludeModel` below,
  // which is the runtime guarantee for that even if this is left unset.
  aiSettings?: { model?: string; maxTokens?: number; freeOnly?: boolean },
  dialect: DialectCode = DEFAULT_DIALECT,
  // The model that actually authored `content` (from runCreatorAgent's /
  // runRewriteAgent's return value), when known. Forwarded to the Gateway
  // so Quality Control is guaranteed to run on a different model — never
  // the same one reviewing its own output. See taskRouter.ts.
  excludeModel?: string | null,
): Promise<{ result: ContentQualityResult | null; error: string | null }> {
  let brandVoice: BrandVoice | null = null;
  try {
    brandVoice = await brandVoiceRepository.get(workspaceId);
  } catch {
    // brand voice is optional context for QC too
  }

  const messages = buildQCMessages(content, platforms, originalRequest, brandVoice, dialect);
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages,
      model: aiSettings?.model,
      temperature: 0.2,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: aiSettings?.freeOnly ?? true,
      brandVoice: null,
      task: 'qc',
      excludeModel: excludeModel ?? undefined,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_qc', input: content, output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    const parsed = parseQCResult(result.content);
    // Phase 2, STEP 11 — attach the Quality Decision Layer's verdict
    // (section 21) right alongside the parsed scores, computed
    // deterministically in code so it's never the model grading itself.
    // QC Hardening Pass: `approved` is likewise always recomputed here from
    // evaluateContentApproval's Critical Dimension Gate — parseQCResult
    // never sets it from the model's own claim.
    const withDecision = parsed
      ? { ...parsed, approved: evaluateContentApproval(content, parsed, isLinkedInPlatform(platforms)).approved, decision: computeQualityDecision(content, parsed, isLinkedInPlatform(platforms)) }
      : parsed;
    return { result: withDecision, error: withDecision ? null : 'qc_parse_failed' };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Quality control failed';
    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_qc', input: content, output: null, model: null, status: 'failed' })
      .catch(() => {});
    return { result: null, error: message };
  }
}

/** Generic Quality-Control loop: Sanitize → Arabic Naturalness Guard → AI
 * Quality Control → evaluateContentApproval, exactly like the AI
 * Assistant's own generation loop, but decoupled from `runCreatorAgent` so
 * ANY place in the app that authors post/content text can reuse the same
 * pass/fail bar instead of re-implementing it. `getCandidate` produces one
 * text candidate per attempt — attempt 0 is typically the content already
 * generated, later attempts should ask the AI to rewrite it addressing
 * `previous.reasons`/`previous.quality?.issues`. Never auto-approves: if
 * nothing passes within `maxAttempts`, the best-scoring candidate is
 * returned with `needsReview: true`, mirroring the AI Assistant's own
 * "kept, but never presented as approved" rule. */
export async function runQualityControlLoop(
  workspaceId: string,
  platforms: string[],
  originalRequest: string | null | undefined,
  // `model` here is the dedicated QC model (ai_settings.qc_model) — the
  // model(s) `getCandidate` itself uses for authoring are a separate,
  // caller-owned concern (see the `model` field it can optionally return
  // below), never this one.
  aiParams: { model?: string; maxTokens?: number },
  getCandidate: (
    attempt: number,
    previous: { content: string; quality: ContentQualityResult | null; reasons: string[] } | null,
  ) => Promise<string | { content: string; model?: string | null }>,
  dialect: DialectCode = DEFAULT_DIALECT,
  maxAttempts: number = MAX_QC_ATTEMPTS,
): Promise<{
  content: string;
  quality: ContentQualityResult | null;
  approved: boolean;
  needsReview: boolean;
  quality_error: boolean;
}> {
  const linkedInTarget = isLinkedInPlatform(platforms);
  let best: { content: string; quality: ContentQualityResult | null; score: number } | null = null;
  let approved = false;
  let lastReasons: string[] = [];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = await getCandidate(attempt, best ? { content: best.content, quality: best.quality, reasons: lastReasons } : null);
    // `getCandidate` may return either a plain string (older callers) or
    // `{ content, model }` when it wants to name the model that actually
    // authored this attempt, so runQualityControlLoop can keep the "QC
    // never reviews its own author" guarantee below.
    const raw = typeof candidate === 'string' ? candidate : candidate.content;
    const authoringModel = typeof candidate === 'string' ? null : candidate.model ?? null;
    if (!raw || !raw.trim()) continue; // candidate generation failed — try again next attempt

    // Deterministic Content Sanitizer — runs BEFORE Quality Control, same
    // as the AI Assistant pipeline. Heavy metadata leakage isn't safely
    // fixable by silent cleanup, so it's treated as a failed attempt.
    const sanitized = sanitizeGeneratedContent(raw);
    if (sanitized.action === 'regenerate') {
      if (!best) best = { content: sanitized.content, quality: null, score: -1 };
      lastReasons = sanitized.reasons.map((r) => `metadata:${r}`);
      continue;
    }
    const content = sanitized.content;

    const qc = await reviewGeneratedContent(workspaceId, content, platforms, originalRequest, aiParams, dialect, authoringModel);
    const quality = qc.result;
    const decision = evaluateContentApproval(content, quality, linkedInTarget);
    lastReasons = decision.reasons;
    const score = quality?.score ?? -1;
    if (!best || score > best.score) best = { content, quality, score };

    if (decision.approved) {
      approved = true;
      best = { content, quality, score };
      break;
    }
    // below the quality bar (or QC unavailable/guard failed) — loop and
    // regenerate via getCandidate, up to maxAttempts total
  }

  const content = best?.content ?? '';
  const quality = best?.quality ?? null;
  const quality_error = !approved && !!content && !quality;
  const needsReview = !!content && !approved;
  return { content, quality, approved, needsReview, quality_error };
}
