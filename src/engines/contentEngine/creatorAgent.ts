import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import type { ChatMessage } from '@/types/ai';
import type { CampaignPlan } from '@/types/assistant';
import type { WorkspaceContext, ContentStrategy, ResearchResult, HookCandidate } from '@/types/context';
import { DEFAULT_DIALECT, type DialectCode } from '@/constants/dialects';
import { isLinkedInPlatform, buildArabicWritingRules, LINKEDIN_WRITING_RULES, OUTPUT_CONTRACT } from './arabicWritingRules';

/** Phase 2, STEP 8 — assembles everything section 14 asks the Content
 * Agent to have beyond the raw request: the extended Brand DNA fields
 * (formality/voice/sentence_style/hook_style/hashtag_policy/content_length/
 * brand_values/audience_relationship/forbidden_words) that the Gateway's
 * own `brand_voice` injection doesn't cover, Audience Intelligence, the
 * Strategy Agent's output, and — only when real, non-invented grounding
 * was actually found — Research evidence. STEP 9 adds the Hook Agent's
 * selected winning candidate as an opening-line directive. Returns null
 * when none of these are available, so a workspace with no Brand Voice /
 * no Strategy / no Research / no winning Hook configured generates exactly
 * like it did before these steps, with no empty/awkward block injected
 * into the prompt. */
function buildIntelligenceContextBlock(
  workspaceContext: WorkspaceContext | null | undefined,
  strategy: ContentStrategy | null | undefined,
  research: ResearchResult | null | undefined,
  contentText?: string | null,
  hook?: HookCandidate | null,
  optimizationContextBlock?: string | null,
): string | null {
  const sections: string[] = [];

  const brand = workspaceContext?.brand;
  if (brand) {
    const lines: string[] = [];
    if (brand.formality) lines.push(`- Formality: ${brand.formality}`);
    if (brand.voice) lines.push(`- Voice: ${brand.voice}`);
    if (brand.sentence_style) lines.push(`- Sentence style: ${brand.sentence_style}`);
    if (brand.hook_style) lines.push(`- Hook style: ${brand.hook_style}`);
    if (brand.hashtag_policy) lines.push(`- Hashtag policy: ${brand.hashtag_policy}`);
    if (brand.content_length) lines.push(`- Preferred content length: ${brand.content_length}`);
    if (brand.brand_values.length) lines.push(`- Brand values: ${brand.brand_values.join(', ')}`);
    if (brand.audience_relationship) lines.push(`- Relationship with audience: ${brand.audience_relationship}`);
    if (brand.forbidden_words.length) lines.push(`- Forbidden words — never use these: ${brand.forbidden_words.join(', ')}`);
    if (lines.length) sections.push(`Brand DNA (in addition to the brand voice already applied above):\n${lines.join('\n')}`);
  }

  const audience = workspaceContext?.audience;
  if (audience) {
    const lines: string[] = [];
    if (audience.persona) lines.push(`- Persona: ${audience.persona}`);
    if (audience.pain_points.length) lines.push(`- Pain points: ${audience.pain_points.join(', ')}`);
    if (audience.desires.length) lines.push(`- Desires: ${audience.desires.join(', ')}`);
    if (audience.objections.length) lines.push(`- Objections to defuse: ${audience.objections.join(', ')}`);
    if (audience.awareness_level) lines.push(`- Awareness level: ${audience.awareness_level}`);
    if (audience.language_style) lines.push(`- Preferred language style: ${audience.language_style}`);
    if (lines.length) sections.push(`Audience Intelligence:\n${lines.join('\n')}`);
  }

  if (strategy) {
    const lines: string[] = [];
    if (strategy.content_pillars.length) lines.push(`- Content pillars: ${strategy.content_pillars.join(', ')}`);
    if (strategy.angles.length) lines.push(`- Suggested angles: ${strategy.angles.join(', ')}`);
    if (strategy.formats.length) lines.push(`- Suggested formats: ${strategy.formats.join(', ')}`);
    if (strategy.cta_strategy) lines.push(`- CTA strategy: ${strategy.cta_strategy}`);
    if (lines.length) sections.push(`Content Strategy for this campaign:\n${lines.join('\n')}`);
  }

  // Phase 2, STEP 9 — Hook Agent. `hook` is the single, already-selected
  // winner (highest total_score, picked deterministically in hookAgent.ts)
  // — never the full candidate list, so the Creator only ever sees one
  // directive to open with, not a menu to choose from itself. This is a
  // directive, not a verbatim requirement: the Creator may adapt phrasing
  // for grammatical fit with the rest of the post, but must keep the same
  // core idea/angle, so a weak hook never becomes the reason the whole post
  // fails Quality Control's Hook criterion.
  if (hook?.text) {
    sections.push(
      `Hook Intelligence — this opening line scored highest across attention/clarity/curiosity/relevance/brand-fit/platform-fit out of several tested candidates. Open the post with it (light phrasing adjustments for grammatical flow with the rest of the post are fine; keep its core idea and angle intact):\n"${hook.text}"`,
    );
  }

  // Only ever included when research_available is true — a Research
  // Decision of "not needed" or a failed/empty research pass means nothing
  // gets added here, never a fabricated substitute (see researchAgent.ts).
  // When evidence extraction produced nothing, the fallback is the raw
  // verified_context — but skip it if it's the exact same text already
  // injected by the Gateway as `content_text` (both ultimately come from
  // collectContentContext), so the same source material never gets sent
  // to the model twice in one request.
  if (research?.research_available) {
    const evidenceText = research.evidence.length
      ? research.evidence.map((e) => `- ${e}`).join('\n')
      : research.verified_context && research.verified_context !== contentText
        ? research.verified_context.slice(0, 4000)
        : '';
    if (evidenceText.trim()) {
      sections.push(
        `Verified research context — grounded in the workspace's own Content Sources. If the post references any facts or numbers, use ONLY what's here; do not add anything beyond it:\n${evidenceText}`,
      );
    }
  }

  // Phase 3, STEP 9/19-21 — Optimization Context. Already rendered by the
  // caller (renderOptimizationContextBlock) so this function stays a pure
  // string-assembly step consistent with every other section here; kept
  // last so it reads as the most recent/dynamic input, after the
  // campaign-level Strategy and static Brand/Audience context above it.
  if (optimizationContextBlock) {
    sections.push(optimizationContextBlock);
  }

  return sections.length ? sections.join('\n\n') : null;
}

/** Builds the Creator Agent's prompt for a single post within the campaign.
 * Brand voice, hashtags, and CTA are all requested inline so the returned
 * text is ready to publish as-is. `originalRequest` is the user's raw,
 * free-text campaign request — passed through verbatim so the Creator keeps
 * the full context of what was actually asked for, not just the Planner's
 * distilled objective/audience/notes summary. `intelligenceContext` (Phase
 * 2, STEP 8) is the optional Workspace/Brand DNA/Audience/Strategy/Research
 * block from buildIntelligenceContextBlock — appended as its own system
 * message, same layering pattern the Gateway itself already uses for
 * brand_voice/content_text server-side. */
function buildCreatorMessages(
  plan: CampaignPlan,
  index: number,
  originalRequest?: string | null,
  dialect: DialectCode = DEFAULT_DIALECT,
  intelligenceContext?: string | null,
): ChatMessage[] {
  const ruleBlocks = [buildArabicWritingRules(dialect)];
  if (isLinkedInPlatform(plan.platforms)) ruleBlocks.push(LINKEDIN_WRITING_RULES);
  ruleBlocks.push(OUTPUT_CONTRACT);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are the Creator agent inside a social media automation assistant. Write ONE complete, ready-to-publish social media post. Output ONLY the final post text — no explanations, no markdown fences, no numbering or labels. Include a strong hook, a concise body, relevant hashtags placed naturally (where appropriate for the platform), and a clear call-to-action.\n\n${ruleBlocks.join('\n\n')}`,
    },
  ];

  if (intelligenceContext) {
    messages.push({ role: 'system', content: intelligenceContext });
  }

  messages.push({
    role: 'user',
    content: `${originalRequest ? `Original user request (verbatim — this is the source of truth for what to write; keep its full context):\n"${originalRequest}"\n\n` : ''}Campaign objective: ${plan.objective}\nTarget audience: ${plan.audience}\nPlatform(s): ${plan.platforms.join(' + ')}\nAdditional notes: ${plan.notes || 'none'}\nThis is post ${index + 1} of ${plan.post_count} in the campaign — keep it on-theme but distinct from the other posts.`,
  });

  return messages;
}

/** Runs the Creator Agent for a single post, applying the workspace's Brand
 * Voice exactly the way every other AI surface in the app does.
 * `originalRequest` is the user's raw campaign request, kept alongside the
 * Planner's structured plan so the Creator never loses the original ask.
 * `workspaceContext`/`strategy`/`research` (Phase 2, STEP 8) and `hook`
 * (Phase 2, STEP 9) are all optional — each defaults to having no effect,
 * so a run without a built WorkspaceContext, Strategy/Research result, or
 * winning Hook candidate generates exactly as it did before these steps. */
export async function runCreatorAgent(
  workspaceId: string,
  plan: CampaignPlan,
  index: number,
  aiSettings?: { model?: string; temperature?: number; maxTokens?: number; freeOnly?: boolean },
  contentText?: string | null,
  originalRequest?: string | null,
  dialect: DialectCode = DEFAULT_DIALECT,
  workspaceContext?: WorkspaceContext | null,
  strategy?: ContentStrategy | null,
  research?: ResearchResult | null,
  hook?: HookCandidate | null,
  optimizationContextBlock?: string | null,
): Promise<{ content: string; error: string | null; model: string | null }> {
  let brandVoice = null as Awaited<ReturnType<typeof brandVoiceRepository.get>>;
  try {
    brandVoice = await brandVoiceRepository.get(workspaceId);
  } catch {
    // brand voice is optional
  }

  const intelligenceContext = buildIntelligenceContextBlock(workspaceContext, strategy, research, contentText, hook, optimizationContextBlock);
  const messages = buildCreatorMessages(plan, index, originalRequest, dialect, intelligenceContext);
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages,
      model: aiSettings?.model,
      temperature: aiSettings?.temperature ?? 0.8,
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
      contentText: contentText ?? null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({
        workspace_id: workspaceId,
        type: 'assistant_creator',
        input: messages.map((m) => m.content).join('\n\n'),
        output: result.content,
        model: result.model,
        status: 'success',
      })
      .catch(() => {});

    return { content: result.content.trim(), error: null, model: result.model || null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Content generation failed';
    aiHistoryRepository
      .create({
        workspace_id: workspaceId,
        type: 'assistant_creator',
        input: messages.map((m) => m.content).join('\n\n'),
        output: null,
        model: null,
        status: 'failed',
      })
      .catch(() => {});
    return { content: '', error: message, model: null };
  }
}
