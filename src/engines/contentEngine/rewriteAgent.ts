import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import type { ChatMessage } from '@/types/ai';
import type { ContentQualityResult } from '@/types/assistant';
import type { WorkspaceContext } from '@/types/context';
import { DEFAULT_DIALECT, type DialectCode } from '@/constants/dialects';
import { isLinkedInPlatform, buildArabicWritingRules, LINKEDIN_WRITING_RULES, OUTPUT_CONTRACT } from './arabicWritingRules';
import { getPlatformProfile } from './platformAgent';

// ============================================================================
// Smart Rewrite — Phase 2, STEP 12 (section 22)
//
// Runs only AFTER a generated draft fails Quality Control
// (evaluateContentApproval -> approved: false) inside the QC retry loop.
// Deliberately NOT a blind re-roll of runCreatorAgent: section 22 says "لا
// تولد نسخة عشوائية جديدة" — instead the Rewrite Task is handed the exact
// failing content plus WHY it failed (the Quality Report, the Deterministic
// Guard's own reasons, and section 20's Critical Issues) alongside the same
// Brand DNA / Audience Intelligence / Platform Rules the Creator had, so it
// can target the actual problem instead of regenerating from scratch and
// possibly reintroducing the same issue. This file only produces the
// rewritten candidate text — the caller still runs it back through the
// unchanged pipeline: Rewrite -> Sanitize -> Guard -> Quality Review ->
// Decision (section 22's own "Rewrite -> Quality Review -> Decision"),
// exactly the loop generateWithQualityControl (useAssistantPipeline.ts) and
// runQualityControlLoop (qualityControl.ts) already run every attempt
// through. The max-attempts ceiling stays MAX_QC_ATTEMPTS/maxAttempts, same
// "configurable حد أقصى" both loops already expose — nothing new needed
// there.
// ============================================================================

const EXTRA_DIMENSION_LABELS: Record<string, string> = {
  hook_score: 'قوة الـHook',
  clarity_score: 'وضوح الفكرة',
  relevance_score: 'الارتباط بالجمهور والهدف',
  brand_score: 'توافق المحتوى مع هوية البراند',
  platform_score: 'ملاءمة المنصة',
  language_score: 'جودة اللغة',
  cta_score: 'جودة الدعوة لإجراء',
  originality_score: 'التفرد وعدم التكرار',
  factual_score: 'موثوقية المعلومات',
  readability_score: 'سهولة القراءة',
  content_value_score: 'الفكرة والقيمة المقدمة',
  substance_score: 'وجود مضمون حقيقي (Substance)',
  structure_score: 'تنظيم وبنية المنشور',
  naturalness_score: 'الطبيعية (عدم بدو النص آليًا)',
  audience_fit_score: 'ملاءمة الجمهور المستهدف',
};

const EXTRA_DIMENSION_MIN = 70;

const DIMENSION_LABELS_AR: Record<string, string> = {
  idea_value: 'الفكرة والقيمة',
  hook: 'الـHook',
  substance: 'جودة المحتوى (Substance)',
  structure: 'البنية',
  arabic_quality: 'العربية الطبيعية',
  naturalness: 'الطبيعية',
  brand_fit: 'توافق البراند',
  audience_fit: 'ملاءمة الجمهور',
  platform_fit: 'ملاءمة المنصة',
  cta: 'الدعوة لإجراء',
  originality: 'التفرد',
  factual_logical: 'السلامة الواقعية والمنطقية',
};

/** Turns a failed Quality Report into the concrete, actionable brief the
 * Rewrite Task needs — never just "try again". QC Hardening Pass: when the
 * QC result carries the full per-dimension `dimensions` record (score/
 * status/reason/evidence/suggested_fix — see qualityControl.ts), this is
 * now the PRIMARY source for the brief: every failing dimension's own
 * `evidence` (what's actually wrong, in the text) and `suggested_fix` (what
 * to change) are handed to the Rewrite Agent directly, exactly what item 7
 * of the brief asks for ("بهذا الـImprovement Agent يعرف ماذا يصلح
 * بالضبط"). Falls back to the legacy flat-field/threshold check below only
 * for an older cached QC result that predates `dimensions`. Also folds in:
 * section 20's Critical Issues, the QC agent's own free-form `issues`, and
 * the Deterministic Guard reasons (from evaluateContentApproval's
 * `reasons`, prefixed `guard:`) that actually triggered this retry. Returns
 * null only when there's genuinely nothing to report, so the caller falls
 * back to a generic "improve this" instruction instead of an empty,
 * uninformative block. */
function buildFailedDimensionsBrief(quality: ContentQualityResult | null, reasons: string[]): string | null {
  const lines: string[] = [];

  if (quality?.critical_issues?.length) {
    lines.push(`- مشاكل حرجة يجب إصلاحها فورًا: ${quality.critical_issues.join('، ')}`);
  }
  if (quality?.issues?.length) {
    lines.push(...quality.issues.map((i) => `- ${i}`));
  }

  if (quality?.dimensions) {
    for (const [key, entry] of Object.entries(quality.dimensions)) {
      if (!entry || entry.status !== 'fail') continue;
      const label = DIMENSION_LABELS_AR[key] ?? key;
      const parts = [`- ${label} ضعيف (${entry.score}/100)`];
      if (entry.evidence) parts.push(`المشكلة تحديدًا: ${entry.evidence}`);
      else if (entry.reason) parts.push(entry.reason);
      if (entry.suggested_fix) parts.push(`الإصلاح المطلوب: ${entry.suggested_fix}`);
      lines.push(parts.join(' — '));
    }
  } else if (quality) {
    // Legacy fallback for a QC result without a `dimensions` record.
    for (const [key, label] of Object.entries(EXTRA_DIMENSION_LABELS)) {
      const score = (quality as unknown as Record<string, number | undefined>)[key];
      if (typeof score === 'number' && score < EXTRA_DIMENSION_MIN) {
        lines.push(`- ${label} ضعيف (${score}/100) — يحتاج تحسينًا مباشرًا.`);
      }
    }
  }

  const guardReasons = reasons.filter((r) => r.startsWith('guard:'));
  if (guardReasons.includes('guard:word_salad') || guardReasons.includes('guard:abnormal_repetition')) {
    lines.push('- الصياغة الحالية بها تكرار غير طبيعي أو تركيب كلمات غير مترابط — أعد بناء الجمل من الصفر بدل تعديلها.');
  }
  if (guardReasons.includes('guard:excessive_latin_mixing')) {
    lines.push('- خلط مفرط بحروف/كلمات لاتينية داخل النص العربي — التزم بالعربية فقط ما لم يكن مصطلحًا تقنيًا شائعًا.');
  }
  if (guardReasons.includes('guard:metadata_leak')) {
    lines.push('- يوجد تسريب لمعلومات تشغيلية (Preview/Status/...) داخل النص — احذفها تمامًا.');
  }
  if (guardReasons.includes('guard:too_short')) {
    lines.push('- النص قصير جدًا — وسّعه ليقدّم قيمة حقيقية للقارئ.');
  }
  if (guardReasons.includes('guard:cliche_opener')) {
    lines.push('- المنشور يبدأ بعبارة افتتاحية مستهلكة/عامة (مثل "في عالم اليوم..." أو "لا شك أن...") — ابدأ بموقف أو فكرة محددة بدلًا منها.');
  }

  return lines.length ? lines.join('\n') : null;
}

/** Brand DNA + Audience Intelligence, in the exact shape section 22 asks
 * the Rewrite Task to receive. Deliberately smaller than creatorAgent's own
 * buildIntelligenceContextBlock: Strategy/Research/Hook steer what NEW
 * content should say, which is irrelevant here — the topic and angle are
 * already fixed by the original draft; only Brand/Audience/Platform matter
 * for fixing an existing piece of text. */
function buildBrandAudienceBlock(workspaceContext?: WorkspaceContext | null): string | null {
  const sections: string[] = [];

  const brand = workspaceContext?.brand;
  if (brand) {
    const lines: string[] = [];
    if (brand.tone) lines.push(`- Tone: ${brand.tone}`);
    if (brand.voice) lines.push(`- Voice: ${brand.voice}`);
    if (brand.formality) lines.push(`- Formality: ${brand.formality}`);
    if (brand.sentence_style) lines.push(`- Sentence style: ${brand.sentence_style}`);
    if (brand.hook_style) lines.push(`- Hook style: ${brand.hook_style}`);
    if (brand.cta_style) lines.push(`- CTA style: ${brand.cta_style}`);
    if (brand.hashtag_policy) lines.push(`- Hashtag policy: ${brand.hashtag_policy}`);
    if (brand.emoji_policy) lines.push(`- Emoji policy: ${brand.emoji_policy}`);
    if (brand.content_length) lines.push(`- Preferred length: ${brand.content_length}`);
    if (brand.brand_values.length) lines.push(`- Brand values: ${brand.brand_values.join(', ')}`);
    if (brand.forbidden_words.length) lines.push(`- Forbidden words — never use these: ${brand.forbidden_words.join(', ')}`);
    if (lines.length) sections.push(`Brand DNA:\n${lines.join('\n')}`);
  }

  const audience = workspaceContext?.audience;
  if (audience?.persona || audience?.pain_points.length || audience?.desires.length || audience?.objections.length) {
    const lines: string[] = [];
    if (audience.persona) lines.push(`- Persona: ${audience.persona}`);
    if (audience.pain_points.length) lines.push(`- Pain points: ${audience.pain_points.join(', ')}`);
    if (audience.desires.length) lines.push(`- Desires: ${audience.desires.join(', ')}`);
    if (audience.objections.length) lines.push(`- Objections to defuse: ${audience.objections.join(', ')}`);
    if (audience.language_style) lines.push(`- Preferred language style: ${audience.language_style}`);
    if (lines.length) sections.push(`Audience Intelligence:\n${lines.join('\n')}`);
  }

  return sections.length ? sections.join('\n\n') : null;
}

/** Section 17 Platform Rules for every target platform of this draft —
 * same DEFAULT_PLATFORM_PROFILES/getPlatformProfile table STEP 10 already
 * built, reused as-is rather than duplicated. */
function buildPlatformRulesBlock(platforms: string[]): string {
  return platforms
    .map((p) => {
      const profile = getPlatformProfile(p);
      return `${profile.platform}:\n- الطول المفضل: ${profile.content_length}\n- النبرة: ${profile.tone}\n- الهيكل: ${profile.structure}\n- قواعد الهاشتاج: ${profile.hashtag_rules}\n- قواعد إضافية: ${profile.format_rules}`;
    })
    .join('\n\n');
}

function buildRewriteMessages(
  content: string,
  quality: ContentQualityResult | null,
  reasons: string[],
  platforms: string[],
  workspaceContext: WorkspaceContext | null | undefined,
  dialect: DialectCode,
): ChatMessage[] {
  const ruleBlocks = [buildArabicWritingRules(dialect)];
  if (isLinkedInPlatform(platforms)) ruleBlocks.push(LINKEDIN_WRITING_RULES);
  ruleBlocks.push(OUTPUT_CONTRACT);

  const brief = buildFailedDimensionsBrief(quality, reasons);
  const brandAudience = buildBrandAudienceBlock(workspaceContext);
  const platformRules = buildPlatformRulesBlock(platforms);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `أنت "Rewrite Agent" داخل نظام أتمتة محتوى السوشيال ميديا. مهمتك إعادة كتابة منشور فشل في اجتياز مراجعة الجودة — وليس توليد منشور جديد من الصفر بموضوع مختلف. حافظ على نفس الموضوع والفكرة الأساسية للمنشور الأصلي، لكن عالج بالتحديد كل مشكلة مذكورة أدناه. أخرج فقط النص النهائي الجاهز للنشر — بدون شرح، بدون Markdown، وبدون أي تكرار لأسباب المشكلة داخل النص نفسه. منشور احترافي حقيقي يحتوي على تفصيل ملموس واحد على الأقل (رقم، مثال، موقف قصير، أو رأي محدد) — لا تكتفِ بنصيحة عامة تصلح لأي موضوع.\n\n${ruleBlocks.join('\n\n')}`,
    },
  ];

  if (brandAudience) messages.push({ role: 'system', content: brandAudience });
  messages.push({ role: 'system', content: `Platform Rules:\n${platformRules}` });

  const problemText = brief
    ? `المشاكل المحددة التي يجب إصلاحها:\n${brief}`
    : 'لم تتوفر تفاصيل محددة عن سبب الفشل — راجع النص بعناية وفق قواعد الكتابة أعلاه وأعد صياغته بجودة أعلى.';
  const suggestionsText = quality?.suggestions?.length
    ? `\n\nاقتراحات إضافية من مراقب الجودة:\n${quality.suggestions.map((s) => `- ${s}`).join('\n')}`
    : '';

  messages.push({
    role: 'user',
    content: `المنشور الأصلي (فشل في مراجعة الجودة):\n"""\n${content}\n"""\n\n${problemText}${suggestionsText}`,
  });

  return messages;
}

/** Runs the Rewrite Task for a single failed draft. Returns `{ content: '',
 * error }` on any failure (network/gateway) — never throws — same
 * non-blocking contract as runCreatorAgent, so the caller's QC loop can
 * treat it exactly like a failed generation attempt and try again next
 * iteration up to its own maxAttempts. */
export async function runRewriteAgent(
  workspaceId: string,
  content: string,
  quality: ContentQualityResult | null,
  reasons: string[],
  platforms: string[],
  aiSettings?: { model?: string; temperature?: number; maxTokens?: number; freeOnly?: boolean },
  workspaceContext?: WorkspaceContext | null,
  dialect: DialectCode = DEFAULT_DIALECT,
): Promise<{ content: string; error: string | null; model: string | null }> {
  let brandVoice = null as Awaited<ReturnType<typeof brandVoiceRepository.get>>;
  try {
    brandVoice = await brandVoiceRepository.get(workspaceId);
  } catch {
    // brand voice is optional context here too
  }

  const messages = buildRewriteMessages(content, quality, reasons, platforms, workspaceContext, dialect);
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages,
      model: aiSettings?.model,
      // Lower than the Creator's 0.8 — a rewrite is a targeted fix, not a
      // fresh creative pass, so it should drift less from the original.
      temperature: aiSettings?.temperature ?? 0.6,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: aiSettings?.freeOnly ?? true,
      task: 'creator',
      brandVoice: brandVoice
        ? {
            business_name: brandVoice.business_name,
            description: brandVoice.description,
            audience: brandVoice.audience,
            industry: brandVoice.industry,
            writing_style: brandVoice.writing_style,
            tone: brandVoice.tone,
            keywords: brandVoice.keywords,
            negative_keywords: brandVoice.negative_keywords,
            cta_style: brandVoice.cta_style,
            emoji_style: brandVoice.emoji_style,
          }
        : null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({
        workspace_id: workspaceId,
        type: 'assistant_rewrite',
        input: messages.map((m) => m.content).join('\n\n'),
        output: result.content,
        model: result.model,
        status: 'success',
      })
      .catch(() => {});

    return { content: result.content.trim(), error: null, model: result.model || null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Rewrite failed';
    aiHistoryRepository
      .create({
        workspace_id: workspaceId,
        type: 'assistant_rewrite',
        input: messages.map((m) => m.content).join('\n\n'),
        output: null,
        model: null,
        status: 'failed',
      })
      .catch(() => {});
    return { content: '', error: message, model: null };
  }
}
