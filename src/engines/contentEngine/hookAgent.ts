import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import type { ChatMessage } from '@/types/ai';
import type { CampaignPlan } from '@/types/assistant';
import type { WorkspaceContext, ContentStrategy, HookCandidate, HookAgentResult } from '@/types/context';
import { DEFAULT_DIALECT, type DialectCode } from '@/constants/dialects';
import { isLinkedInPlatform } from './arabicWritingRules';
import { stripFence } from './contentGuards';

// ============================================================================
// Hook Agent — Phase 2, STEP 9
//
// Input:  Workspace Context (Brand DNA + Audience Intelligence) + Strategy
//         (STEP 6, when available) + the campaign plan/platform.
// Output: several Hook candidates (spec: "Hook A..E"), each scored on
//         attention/clarity/curiosity/relevance/brand_fit/platform_fit, with
//         the highest-scoring one selected deterministically in code (never
//         by trusting the model's own pick — same principle as Strategy's
//         platform_priorities and QC's evaluateContentApproval).
//
// The winning hook is handed to the Content Agent (creatorAgent.ts) as a
// directive for the post's opening line — it does not bypass the Creator or
// get published on its own; it only narrows what the Creator opens with,
// the same "optional, additive context" role Strategy/Research already
// play there.
//
// Runs through the existing AI Orchestrator -> AI Gateway path, same as
// every other agent — no provider-specific calls here.
// ============================================================================

const HOOK_COUNT = 5;
const SCORE_KEYS = ['attention_score', 'clarity_score', 'curiosity_score', 'relevance_score', 'brand_fit', 'platform_fit'] as const;

function clampScore(n: unknown): number {
  const num = Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.min(100, Math.max(0, Math.round(num)));
}

/** Builds the Hook Agent's prompt. Must respond with strict JSON only —
 * same contract as every other pipeline agent (Planner, Strategy, QC). */
function buildHookMessages(
  plan: CampaignPlan,
  workspaceContext: WorkspaceContext | null,
  strategy: ContentStrategy | null,
  dialect: DialectCode,
): ChatMessage[] {
  const brand = workspaceContext?.brand;
  const audience = workspaceContext?.audience;
  const linkedInTarget = isLinkedInPlatform(plan.platforms);

  const brandParts: string[] = [];
  if (brand?.business_name) brandParts.push(`الاسم/النشاط: ${brand.business_name}`);
  if (brand?.tone) brandParts.push(`نبرة الحساب: ${brand.tone}`);
  if (brand?.hook_style) brandParts.push(`أسلوب الـHook المعتاد للبراند: ${brand.hook_style}`);
  if (brand?.voice) brandParts.push(`الصوت: ${brand.voice}`);
  const brandText = brandParts.length ? brandParts.join('\n') : 'لا تتوفر بيانات Brand DNA إضافية.';

  const audienceParts: string[] = [];
  if (audience?.persona) audienceParts.push(`Persona: ${audience.persona}`);
  if (audience?.pain_points?.length) audienceParts.push(`نقاط الألم: ${audience.pain_points.join('، ')}`);
  if (audience?.desires?.length) audienceParts.push(`الرغبات: ${audience.desires.join('، ')}`);
  if (audience?.awareness_level) audienceParts.push(`مستوى الوعي: ${audience.awareness_level}`);
  const audienceText = audienceParts.length ? audienceParts.join('\n') : 'لا تتوفر بيانات Audience Intelligence هيكلية.';

  const strategyParts: string[] = [];
  if (strategy?.angles?.length) strategyParts.push(`الزوايا المقترحة: ${strategy.angles.join('، ')}`);
  if (strategy?.content_pillars?.length) strategyParts.push(`محاور المحتوى: ${strategy.content_pillars.join('، ')}`);
  const strategyText = strategyParts.length ? strategyParts.join('\n') : 'لا تتوفر Content Strategy لهذه الحملة.';

  const platforms = plan.platforms.length ? plan.platforms.join(', ') : 'غير محددة';

  return [
    {
      role: 'system',
      content: `أنت "Hook Agent" داخل مساعد ذكي لإدارة السوشيال ميديا. مهمتك: إنتاج ${HOOK_COUNT} جمل افتتاحية (Hooks) مختلفة تمامًا عن بعضها لنفس المنشور، ثم تقييم كل واحدة منها بموضوعية — وليس اختيار الأفضل بنفسك، هذا يتم لاحقًا بشكل منفصل.

قواعد إلزامية:
- كل Hook جملة واحدة أو اثنتين كحد أقصى، بلهجة عربية طبيعية (${dialect === 'egyptian' ? 'مصرية' : dialect}), وليست فصحى.
- نوّع بين أساليب مختلفة عبر الـ${HOOK_COUNT} خيارات (سؤال، رقم/إحصائية، تصريح جريء، قصة قصيرة، تحدي لفكرة شائعة) — لا تكرر نفس الأسلوب.
- كل Hook يجب أن يكون مرتبطًا فعليًا بهدف الحملة والجمهور المُعطى، وليس عامًا.
${linkedInTarget ? '- المنصة المستهدفة تتضمن LinkedIn — لا تبدأ بمقدمة عامة، ولا تستخدم صيغة "هل سبق لك أن..." إلا إذا كانت قوية وذكية فعلًا.' : ''}
- قيّم كل Hook بأمانة على 6 معايير من 0 إلى 100: attention_score (قوة لفت الانتباه)، clarity_score (وضوح الفكرة)، curiosity_score (إثارة الفضول لإكمال القراءة)، relevance_score (ارتباطه بالجمهور والهدف)، brand_fit (توافقه مع هوية البراند)، platform_fit (ملاءمته للمنصة المستهدفة).
- لا تجعل كل الـHooks تحصل على نفس الدرجات تقريبًا — التقييم يجب أن يعكس فروقًا حقيقية بين الأساليب المختلفة.

أرجع JSON فقط بهذا الشكل بالضبط، بدون أي نص أو Markdown قبله أو بعده:
{"hooks": [{"text": string, "attention_score": number, "clarity_score": number, "curiosity_score": number, "relevance_score": number, "brand_fit": number, "platform_fit": number}]}
مصفوفة "hooks" يجب أن تحتوي بالضبط على ${HOOK_COUNT} عناصر.`,
    },
    {
      role: 'user',
      content: `هدف الحملة: ${plan.objective}\nالجمهور: ${plan.audience}\nالمنصات: ${platforms}\n\nAudience Intelligence:\n${audienceText}\n\nBrand DNA:\n${brandText}\n\nContent Strategy:\n${strategyText}\n\nملاحظات إضافية: ${plan.notes || 'لا يوجد'}`,
    },
  ];
}

/** Parses the strict-JSON response into scored candidates. `total_score` is
 * always computed here (average of the six sub-scores) rather than trusted
 * from the model. Never throws — returns an empty array on any parse
 * failure so the caller can treat the Hook Agent as unavailable for this
 * run, exactly like Strategy/Research on failure. */
function parseHooks(raw: string): HookCandidate[] {
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    const rawHooks = Array.isArray(json.hooks) ? json.hooks : [];
    return rawHooks
      .map((h): HookCandidate | null => {
        if (!h || typeof h !== 'object') return null;
        const obj = h as Record<string, unknown>;
        const text = typeof obj.text === 'string' ? obj.text.trim() : '';
        if (!text) return null;
        const scores = Object.fromEntries(SCORE_KEYS.map((k) => [k, clampScore(obj[k])])) as Record<(typeof SCORE_KEYS)[number], number>;
        const total_score = Math.round(SCORE_KEYS.reduce((sum, k) => sum + scores[k], 0) / SCORE_KEYS.length);
        return { text, ...scores, total_score };
      })
      .filter((h): h is HookCandidate => h !== null);
  } catch {
    return [];
  }
}

/** Deterministically picks the candidate with the highest total_score —
 * ties keep the first (model's original order), never re-decided at
 * random. Returns null on an empty list. */
function pickBest(hooks: HookCandidate[]): HookCandidate | null {
  if (!hooks.length) return null;
  return hooks.reduce((best, h) => (h.total_score > best.total_score ? h : best), hooks[0]);
}

/** Runs the Hook Agent and returns every scored candidate plus the
 * deterministically-selected best one. Never throws: on any failure
 * (network, parsing) it returns `{ hooks: [], best: null }` so the caller
 * (Creator Agent, via useAssistantPipeline's hookRef) treats a missing hook
 * exactly like a missing Strategy/Research result — optional context, never
 * a pipeline blocker. */
export async function runHookAgent(
  workspaceId: string,
  plan: CampaignPlan,
  workspaceContext: WorkspaceContext | null,
  strategy: ContentStrategy | null,
  aiSettings?: { model?: string; temperature?: number; maxTokens?: number; freeOnly?: boolean },
  dialect: DialectCode = DEFAULT_DIALECT,
): Promise<{ result: HookAgentResult; raw: string; error: string | null }> {
  const messages = buildHookMessages(plan, workspaceContext, strategy, dialect);
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages,
      model: aiSettings?.model,
      temperature: 0.7,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: aiSettings?.freeOnly ?? true,
      brandVoice: null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_hook', input: plan.objective, output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    const hooks = parseHooks(result.content);
    return { result: { hooks, best: pickBest(hooks) }, raw: result.content, error: hooks.length ? null : 'hook_parse_failed' };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Hook generation failed';
    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_hook', input: plan.objective, output: null, model: null, status: 'failed' })
      .catch(() => {});
    return { result: { hooks: [], best: null }, raw: '', error: message };
  }
}
