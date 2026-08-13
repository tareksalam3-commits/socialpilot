import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import type { ChatMessage, BrandVoice } from '@/types/ai';
import type { ContentQualityResult } from '@/types/assistant';
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

const CRITICAL_ISSUE_KEYS = ['factual_error', 'brand_violation', 'forbidden_term', 'platform_violation', 'unsafe_content'] as const;

/** Parses the strict-JSON response the QC model is instructed to return.
 * Returns null (never throws) on anything that isn't valid — the caller
 * treats that as "QC unavailable" rather than blocking the pipeline.
 * Phase 2, STEP 11 — also parses section 19's extra Quality Dimensions and
 * section 20's Critical Issues. `critical_issues` is filtered against
 * CRITICAL_ISSUE_KEYS so the model can never inject an arbitrary label
 * that wasn't one of the five defined categories (structured output, per
 * STEP 26 — never free-form text where a decision is going to read it). */
function parseQCResult(raw: string): ContentQualityResult | null {
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    const score = clampScore(json.score);
    const approved = typeof json.approved === 'boolean' ? json.approved : score >= 80;
    const issues = Array.isArray(json.issues) ? (json.issues as unknown[]).filter((i): i is string => typeof i === 'string') : [];
    const suggestions = Array.isArray(json.suggestions)
      ? (json.suggestions as unknown[]).filter((i): i is string => typeof i === 'string')
      : [];
    const result: ContentQualityResult = { approved, score, issues, suggestions };
    if (json.arabic_quality !== undefined) result.arabic_quality = clampScore(json.arabic_quality);
    if (json.linkedin_fit !== undefined) result.linkedin_fit = clampScore(json.linkedin_fit);
    if (json.brand_fit !== undefined) result.brand_fit = clampScore(json.brand_fit);
    if (json.hook_score !== undefined) result.hook_score = clampScore(json.hook_score);
    if (json.clarity_score !== undefined) result.clarity_score = clampScore(json.clarity_score);
    if (json.relevance_score !== undefined) result.relevance_score = clampScore(json.relevance_score);
    if (json.brand_score !== undefined) result.brand_score = clampScore(json.brand_score);
    if (json.platform_score !== undefined) result.platform_score = clampScore(json.platform_score);
    if (json.language_score !== undefined) result.language_score = clampScore(json.language_score);
    if (json.cta_score !== undefined) result.cta_score = clampScore(json.cta_score);
    if (json.originality_score !== undefined) result.originality_score = clampScore(json.originality_score);
    if (json.factual_score !== undefined) result.factual_score = clampScore(json.factual_score);
    if (json.readability_score !== undefined) result.readability_score = clampScore(json.readability_score);
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
 * the Creator prompt alone didn't prevent. */
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

  return [
    {
      role: 'system',
      content: `أنت "Arabic Content Quality Control" — مراقب جودة محتوى عربي متخصص في منشورات LinkedIn وPersonal Branding. راجع النص المرفق بموضوعية صارمة وأرجع JSON فقط، بدون أي شرح أو Markdown أو نص إضافي قبله أو بعده.

قيّم النص وفق هذه المعايير العشرة:
1. Arabic Naturalness (اللهجة المطلوبة لهذا المحتوى: ${meta.name}) — هل هو "عربية ${meta.name} مهنية طبيعية" فعلًا (وليس فصحى، ولا عربية رسمية ثقيلة، ولا ترجمة حرفية/آلية، ولا لهجة عربية أخرى مثل ${otherDialectNames})؟ راجع أيضًا أن الصياغة مُعاد بناؤها بالكامل بلهجة ${meta.name} وليست فصحى تم فيها استبدال كلمات بمرادفات ${meta.name.replace(/^ال/, '')} فقط.
2. Grammar — سلامة القواعد والصياغة.
3. Clarity — وضوح الفكرة.
4. Hook — قوة الجملة الافتتاحية.
5. Value — القيمة الحقيقية المقدمة للقارئ.
6. Human Tone — نبرة إنسانية طبيعية، وليست آلية.
7. Brand Voice Alignment — مدى الالتزام بهوية العلامة.
8. LinkedIn Fit — ملاءمة النص لمعايير LinkedIn (إن كانت المنصة المستهدفة LinkedIn).
9. CTA Quality — جودة الدعوة لإجراء ونهاية المنشور.
10. AI-like / Translated phrasing — اكتشاف أي صياغة تبدو كترجمة آلية أو غير طبيعية.

بالإضافة إلى ذلك، قيّم كل بُعد من الأبعاد التالية بدرجة منفصلة من 0 إلى 100 (Smart Quality Engine):
- hook_score: قوة الـHook تحديدًا (مستقل عن score العام).
- clarity_score: وضوح الفكرة الأساسية.
- relevance_score: ارتباط المحتوى بالجمهور والهدف المُعطى.
- brand_score: مدى توافق المحتوى مع هوية البراند (نفس معنى brand_fit).
- platform_score: ملاءمة المحتوى للمنصة المستهدفة تحديدًا.
- language_score: سلامة اللغة وجودتها بشكل عام (مستقل عن arabic_quality الخاص باللهجة).
- cta_score: جودة الدعوة لإجراء.
- originality_score: مدى تفرّد المحتوى وعدم كونه نمطيًا/مكررًا.
- factual_score: موثوقية أي معلومات أو أرقام واردة في النص (100 لو لا توجد ادعاءات واقعية تحتاج تحققًا أصلًا).
- readability_score: سهولة قراءة النص وتنظيمه.

Critical Issues (قائمة critical_issues) — أضف أي من هذه القيم الخمس فقط (بنفس الأسماء بالإنجليزية بالضبط) لو انطبقت، وإلا اترك المصفوفة فارغة. لا تخترع تصنيفات أخرى:
- "factual_error": معلومة أو رقم خاطئ بشكل واضح.
- "brand_violation": يخالف قيم أو هوية البراند المذكورة.
- "forbidden_term": يحتوي على كلمة من الكلمات الممنوعة أدناه.
- "platform_violation": يخالف قاعدة إلزامية للمنصة المستهدفة (مثل تجاوز حد الهاشتاجات في LinkedIn).
- "unsafe_content": محتوى غير آمن للنشر (تحريضي، مضلل بشكل خطير، أو غير لائق).
أي عنصر في critical_issues يعني أن هذا المحتوى لا يجوز اعتماده مهما كانت باقي الدرجات مرتفعة.

${linkedInTarget ? 'المنصة المستهدفة تتضمن LinkedIn — طبّق معايير LinkedIn بصرامة (Hook قوي، فقرات قصيرة، لا CTA تقليدي، 4 إلى 6 هاشتاجات كحد أقصى، بدون Emoji إلا إذا سمح Brand Voice).' : ''}
كلمات ممنوعة من Brand Voice (negative_keywords) يجب ألا تظهر في النص إطلاقًا: ${negativeKeywords}

قواعد رفض إلزامية (Hard Fail Rules) — اجعل approved = false إذا كان النص:
- غير مفهوم لقارئ عربي طبيعي، أو يحتاج إعادة قراءة لفهم المقصود.
- يحتوي على ما يبدو ترجمة آلية واضحة (تركيب جمل غير عربي، أو اختيار كلمات غريبة عن السياق).
- مكتوب بالفصحى أو بعربية رسمية ثقيلة بدل لهجة ${meta.name} المهنية المطلوبة.
- مكتوب بلهجة عربية غير ${meta.name} (${otherDialectNames}) أو خليط لهجات.
- فصحى تم فيها استبدال بعض الكلمات بمرادفات ${meta.name.replace(/^ال/, '')} فقط دون إعادة صياغة الجملة كاملة بأسلوب طبيعي بلهجة ${meta.name}.
- يبدأ بـ Hook غير منطقي أو لا علاقة له بموضوع المنشور.
- يستخدم كلمات عربية صحيحة لغويًا لكنها خارج سياقها الطبيعي في هذا الموضوع.
- يبدو كتركيب عشوائي من كلمات عربية متفرقة بلا رابط منطقي بينها.
- يحتوي على أي معلومات UI أو تشغيلية (مثل Preview، Platform، Account، Scheduled، Status، Awaiting Confirmation، Content Score، Quality Score).
- يبدو كإعلان مولّد آليًا بدل منشور شخصي طبيعي.

مهم جدًا: score >= 80 وحدها لا تعني الموافقة. إذا كانت Arabic Naturalness ضعيفة (arabic_quality منخفض — أي النص فصحى أو ترجمة حرفية أو لهجة غير ${meta.name}) فيجب أن تكون approved = false حتى لو كانت score العامة مرتفعة. مثال: arabic_quality = 55 مع score = 85 يجب أن تُرجع approved = false. معيار arabic_quality نفسه بغض النظر عن اللهجة المطلوبة هو نفس معيار الجودة اللغوية العالية المطبّق على العربية المصرية المهنية (المرجع الأساسي لجودة النظام) — وليس معيارًا أخف لمجرد أن اللهجة المطلوبة ليست المصرية.

الدرجة (score) من 0 إلى 100. approved يجب أن يكون true فقط إذا كانت score >= 80 وكانت Arabic Naturalness (arabic_quality) طبيعية فعلًا وليست ضعيفة.

أرجع JSON فقط بهذا الشكل بالضبط (بدون أي نص آخر):
{"approved": boolean, "score": number, "issues": string[], "suggestions": string[], "arabic_quality": number, "linkedin_fit": number, "brand_fit": number, "hook_score": number, "clarity_score": number, "relevance_score": number, "brand_score": number, "platform_score": number, "language_score": number, "cta_score": number, "originality_score": number, "factual_score": number, "readability_score": number, "critical_issues": string[]}`,
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
  aiSettings?: { model?: string; maxTokens?: number },
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
      freeOnly: true,
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
    const withDecision = parsed ? { ...parsed, decision: computeQualityDecision(content, parsed, isLinkedInPlatform(platforms)) } : parsed;
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
