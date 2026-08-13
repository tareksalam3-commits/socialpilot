import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import type { ChatMessage, BrandVoice } from '@/types/ai';
import type { CampaignPlan, AudienceInference } from '@/types/assistant';
import { stripFence } from './contentGuards';
import { DEFAULT_PLAN } from './plannerAgent';

// ============================================================================
// Audience Inference Agent
//
// Runs right after the Planner and pauses the pipeline for User Approval
// before any content is generated: User Request → Planner → Audience
// Inference → User Approval → Content Generation → Quality Control →
// Preview → Schedule/Publish. There is deliberately no Audience Management/
// Database/Segmentation system and no persisted "default audience" — every
// request gets a fresh, per-post inference so the user is never asked to
// type an audience by hand.
// ============================================================================

/** Below this confidence, the Audience Inference suggestion is shown as
 * "needs review" rather than a settled recommendation — never hidden or
 * silently downgraded to the fallback, just flagged. */
export const AUDIENCE_MIN_CONFIDENCE = 0.7;

/** Builds the Audience Inference agent's prompt. Must respond with strict
 * JSON only — same contract as the Planner and QC agents. Infers the best
 * Target Audience for THIS post from the workspace's professional identity/
 * Brand Voice context, the post's goal and topic, and its target
 * platform(s) — never a static value copied straight from Brand Voice's own
 * `audience` field, which (when present) is passed in only as one weak,
 * optional signal like everything else here. */
function buildAudienceMessages(request: string, plan: CampaignPlan, brandVoice: BrandVoice | null): ChatMessage[] {
  const profileParts: string[] = [];
  if (brandVoice?.business_name) profileParts.push(`الاسم/النشاط: ${brandVoice.business_name}`);
  if (brandVoice?.industry) profileParts.push(`المجال: ${brandVoice.industry}`);
  if (brandVoice?.description) profileParts.push(`الوصف: ${brandVoice.description}`);
  if (brandVoice?.tone) profileParts.push(`نبرة الحساب: ${brandVoice.tone}`);
  if (brandVoice?.writing_style) profileParts.push(`أسلوب الكتابة: ${brandVoice.writing_style}`);
  if (brandVoice?.keywords?.length) profileParts.push(`كلمات مفتاحية متكررة: ${brandVoice.keywords.join('، ')}`);
  if (brandVoice?.audience) {
    profileParts.push(`جمهور عام مذكور سابقًا في إعدادات الحساب (إشارة ضعيفة فقط، وليس إجابة جاهزة): ${brandVoice.audience}`);
  }
  const profileText = profileParts.length ? profileParts.join('\n') : 'لا تتوفر بيانات هوية إضافية عن صاحب الحساب.';

  return [
    {
      role: 'system',
      content: `أنت "Audience Inference Agent" داخل مساعد ذكي لإدارة السوشيال ميديا. مهمتك الوحيدة: استنتاج أفضل جمهور مستهدف (Target Audience) لهذا المنشور تحديدًا — وليس جمهورًا عامًا وثابتًا لكل منشورات الحساب.

اعتمد في الاستنتاج على كل هذه العناصر معًا:
1. هوية المستخدم المهنية ومجال عمله (من بيانات الحساب أدناه).
2. Brand Voice (النبرة، الأسلوب، الكلمات المفتاحية).
3. هدف المنشور (Post Goal).
4. موضوع المنشور (Post Topic) — طلب المستخدم نفسه.
5. سياق المنشور (Post Context) — المنصة المستهدفة والملاحظات الإضافية.

قواعد إلزامية:
- لا تستنتج الجمهور من الموضوع فقط؛ اربطه دائمًا بهوية صاحب الحساب ومجال عمله.
- إن وُجد "جمهور عام مذكور سابقًا في إعدادات الحساب" فلا تُرجعه كما هو دون تحليل — استخدمه كإشارة ضعيفة فقط إذا كان متوافقًا فعلًا مع موضوع هذا المنشور تحديدًا، وتجاهله إن لم يكن متوافقًا.
- اجعل الجمهور جملة عربية موجزة ومحددة (سطر واحد قصير)، وليس قائمة أو فقرة.
- إن لم تكن واثقًا بدرجة كافية، اجعل confidence منخفضة (أقل من 0.7) بدلًا من اختلاق دقة زائفة.

أرجع JSON فقط بهذا الشكل بالضبط، بدون أي نص أو Markdown قبله أو بعده:
{"audience": string, "reason": string, "confidence": number}
حيث confidence رقم عشري بين 0 و1.`,
    },
    {
      role: 'user',
      content: `بيانات هوية الحساب (User Profile + Brand Voice):\n${profileText}\n\nهدف المنشور (Post Goal): ${plan.objective}\nمنصة/منصات النشر (Post Context): ${plan.platforms.join(' + ') || 'غير محددة'}\nملاحظات إضافية: ${plan.notes || 'لا يوجد'}\n\nموضوع المنشور (Post Topic) — طلب المستخدم الأصلي:\n"""\n${request}\n"""`,
    },
  ];
}

function clampConfidence(n: unknown): number {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.min(1, Math.max(0, num));
}

/** Parses the strict-JSON response the Audience Inference model is
 * instructed to return. Never throws — falls back to the Planner's own
 * audience guess with confidence 0 on anything unparsable, so a bad model
 * response degrades to "needs review" rather than blocking the pipeline. */
function parseAudienceResult(raw: string, fallbackAudience: string): AudienceInference {
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    const audience = typeof json.audience === 'string' && json.audience.trim() ? json.audience.trim() : fallbackAudience;
    const reason = typeof json.reason === 'string' ? json.reason.trim() : '';
    return { audience, reason, confidence: clampConfidence(json.confidence) };
  } catch {
    return { audience: fallbackAudience, reason: '', confidence: 0 };
  }
}

/** Runs the Audience Inference Agent and pauses the pipeline for User
 * Approval. Never throws: on any failure (network, parsing) it falls back
 * to the Planner's own audience guess with confidence 0, which the UI shows
 * as "needs review" rather than blocking the request — the user can still
 * approve or freely edit it with one tap. */
export async function runAudienceInferenceAgent(
  workspaceId: string,
  request: string,
  plan: CampaignPlan,
  aiSettings?: { model?: string; maxTokens?: number },
): Promise<{ inference: AudienceInference; raw: string; error: string | null }> {
  let brandVoice: BrandVoice | null = null;
  try {
    brandVoice = await brandVoiceRepository.get(workspaceId);
  } catch {
    // brand voice is optional context here too
  }

  const fallbackAudience = plan.audience?.trim() || DEFAULT_PLAN.audience;
  const messages = buildAudienceMessages(request, plan, brandVoice);
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages,
      model: aiSettings?.model,
      temperature: 0.3,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: true,
      brandVoice: null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_audience', input: request, output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    return { inference: parseAudienceResult(result.content, fallbackAudience), raw: result.content, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Audience inference failed';
    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_audience', input: request, output: null, model: null, status: 'failed' })
      .catch(() => {});
    return { inference: { audience: fallbackAudience, reason: '', confidence: 0 }, raw: '', error: message };
  }
}
