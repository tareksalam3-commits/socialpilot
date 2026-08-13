import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import type { ChatMessage } from '@/types/ai';
import type { CampaignPlan } from '@/types/assistant';
import type { WorkspaceContext, ContentStrategy } from '@/types/context';
import { stripFence } from './contentGuards';

// ============================================================================
// Strategy Agent — Phase 2, STEP 6
//
// Input:  Business Goal (plan.objective) + Audience (the user-approved
//         audience plus, when available, the workspace's structured
//         Audience Intelligence) + Brand (Brand DNA) + Platform.
// Output: a Structured Content Strategy (never free-form prose) that later
//         agents — Content, Hook, Platform Adaptation (STEP 8+) — can read
//         from once they're wired to take it as an input. STEP 6 itself is
//         scoped to producing that strategy correctly, the same way STEP 5
//         built WorkspaceContext without any agent consuming it yet.
//
// Runs through the existing AI Orchestrator -> AI Gateway path (aiGateway.
// generate), same as the Planner and Audience Inference agents — no
// provider-specific calls here, per the Phase 2 ban on Agents talking to
// providers directly.
// ============================================================================

const DEFAULT_STRATEGY: ContentStrategy = {
  objective: '',
  content_pillars: [],
  angles: [],
  formats: [],
  platform_priorities: [],
  cta_strategy: '',
  recommended_frequency: '',
  success_metrics: [],
};

/** Builds the Strategy Agent's prompt. Must respond with strict JSON only —
 * same contract as every other pipeline agent (Planner, Audience, QC). */
function buildStrategyMessages(
  plan: CampaignPlan,
  workspaceContext: WorkspaceContext | null,
): ChatMessage[] {
  const brand = workspaceContext?.brand;
  const audience = workspaceContext?.audience;

  const brandParts: string[] = [];
  if (brand?.business_name) brandParts.push(`الاسم/النشاط: ${brand.business_name}`);
  if (brand?.industry) brandParts.push(`المجال: ${brand.industry}`);
  if (brand?.tone) brandParts.push(`نبرة الحساب: ${brand.tone}`);
  if (brand?.voice) brandParts.push(`الصوت: ${brand.voice}`);
  if (brand?.brand_values?.length) brandParts.push(`قيم البراند: ${brand.brand_values.join('، ')}`);
  if (brand?.cta_style) brandParts.push(`أسلوب الـCTA المعتاد: ${brand.cta_style}`);
  const brandText = brandParts.length ? brandParts.join('\n') : 'لا تتوفر بيانات Brand DNA إضافية.';

  const audienceParts: string[] = [];
  if (audience?.persona) audienceParts.push(`Persona: ${audience.persona}`);
  if (audience?.pain_points?.length) audienceParts.push(`نقاط الألم: ${audience.pain_points.join('، ')}`);
  if (audience?.desires?.length) audienceParts.push(`الرغبات: ${audience.desires.join('، ')}`);
  if (audience?.awareness_level) audienceParts.push(`مستوى الوعي: ${audience.awareness_level}`);
  const audienceText = audienceParts.length
    ? audienceParts.join('\n')
    : 'لا تتوفر بيانات Audience Intelligence هيكلية — استخدم وصف الجمهور أدناه فقط.';

  const platforms = plan.platforms.length ? plan.platforms.join(', ') : 'غير محددة';

  return [
    {
      role: 'system',
      content: `أنت "Strategy Agent" داخل مساعد ذكي لإدارة السوشيال ميديا. مهمتك: تحويل (Business Goal + Audience + Brand + Platform) إلى Content Strategy واحدة موجزة وقابلة للتنفيذ — وليس محتوى فعليًا، وليس نصًا حرًا.

قواعد إلزامية:
- اربط كل عنصر في الاستراتيجية بالهدف والجمهور والبراند المُعطى فعليًا؛ لا تخترع قيمًا عامة لا علاقة لها بالسياق.
- "platform_priorities" يجب أن تكون فقط من ضمن المنصات المُعطاة أدناه، مرتبة بالأهم أولًا.
- اجعل "content_pillars" و"angles" و"formats" و"success_metrics" مصفوفات قصيرة (3-5 عناصر) وليست فقرات.
- "cta_strategy" و"recommended_frequency" جملة واحدة موجزة لكل منهما.

أرجع JSON فقط بهذا الشكل بالضبط، بدون أي نص أو Markdown قبله أو بعده:
{"objective": string, "content_pillars": string[], "angles": string[], "formats": string[], "platform_priorities": string[], "cta_strategy": string, "recommended_frequency": string, "success_metrics": string[]}`,
    },
    {
      role: 'user',
      content: `هدف العمل (Business Goal): ${plan.objective}\n\nالجمهور المعتمد (Audience): ${plan.audience}\nAudience Intelligence:\n${audienceText}\n\nBrand DNA:\n${brandText}\n\nالمنصات المتاحة لهذه الحملة (Platform): ${platforms}`,
    },
  ];
}

/** Keeps platform_priorities honest: only platforms that were actually
 * offered to the agent, in the order the model returned them, followed by
 * any it left out (so nothing silently disappears from the run's own plan
 * if the model's list was incomplete). */
function resolvePlatformPriorities(raw: unknown, availablePlatforms: string[]): string[] {
  const requested = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : [];
  const kept = requested.filter((p) => availablePlatforms.includes(p));
  const missing = availablePlatforms.filter((p) => !kept.includes(p));
  return [...kept, ...missing];
}

function toStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];
}

/** Parses the strict-JSON response. Never throws — falls back to a strategy
 * derived straight from the plan (objective + platforms, everything else
 * empty) on any parse failure, so a bad model response degrades gracefully
 * instead of blocking the pipeline, same as the Planner and Audience
 * agents. */
function parseStrategy(raw: string, plan: CampaignPlan): ContentStrategy {
  const fallback: ContentStrategy = { ...DEFAULT_STRATEGY, objective: plan.objective, platform_priorities: plan.platforms };
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    return {
      objective: typeof json.objective === 'string' && json.objective.trim() ? json.objective.trim() : fallback.objective,
      content_pillars: toStringArray(json.content_pillars),
      angles: toStringArray(json.angles),
      formats: toStringArray(json.formats),
      platform_priorities: resolvePlatformPriorities(json.platform_priorities, plan.platforms),
      cta_strategy: typeof json.cta_strategy === 'string' ? json.cta_strategy.trim() : '',
      recommended_frequency: typeof json.recommended_frequency === 'string' ? json.recommended_frequency.trim() : '',
      success_metrics: toStringArray(json.success_metrics),
    };
  } catch {
    return fallback;
  }
}

/** Runs the Strategy Agent and returns a validated ContentStrategy. Never
 * throws: on any failure (network, parsing) it falls back to a minimal
 * strategy built from the plan alone, exactly like Planner/Audience —
 * a Strategy Agent failure must never block Content Generation. */
export async function runStrategyAgent(
  workspaceId: string,
  plan: CampaignPlan,
  workspaceContext: WorkspaceContext | null,
  aiSettings?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<{ strategy: ContentStrategy; raw: string; error: string | null }> {
  const messages = buildStrategyMessages(plan, workspaceContext);
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages,
      model: aiSettings?.model,
      temperature: 0.4,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: true,
      brandVoice: null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_strategy', input: plan.objective, output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    return { strategy: parseStrategy(result.content, plan), raw: result.content, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Strategy generation failed';
    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_strategy', input: plan.objective, output: null, model: null, status: 'failed' })
      .catch(() => {});
    return {
      strategy: { ...DEFAULT_STRATEGY, objective: plan.objective, platform_priorities: plan.platforms },
      raw: '',
      error: message,
    };
  }
}
