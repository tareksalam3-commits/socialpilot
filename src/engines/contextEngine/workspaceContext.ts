import { workspaceRepository } from '@/repositories/workspaceRepository';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import { audienceProfileRepository } from '@/repositories/audienceProfileRepository';
import { accountRepository } from '@/repositories/accountRepository';
import { WORKSPACE_CONTEXT_VERSION } from '@/types/context';
import type { WorkspaceContext } from '@/types/context';

/** Context Builder — Phase 2, STEP 2.
 *
 * Assembles the single structured WorkspaceContext from EXISTING tables
 * (workspaces, brand_voice, connected_accounts). This is meant to become
 * the one place that reads workspace-level data for AI tasks — agents
 * should take a WorkspaceContext as a parameter rather than querying
 * repositories directly. STEP 27 (AI Context Management) will add
 * per-task field selection on top of this so a Hook task doesn't pull the
 * same payload as a Strategy task; this function is the full object that
 * selection narrows down from.
 *
 * Never throws for a missing Brand Voice row or zero connected accounts —
 * an unconfigured workspace still gets a valid, partially-empty context.
 * It only throws if the workspace itself doesn't exist, since every
 * caller needs a real workspace to build context for. */
export async function buildWorkspaceContext(workspaceId: string): Promise<WorkspaceContext> {
  const workspace = await workspaceRepository.getById(workspaceId);
  if (!workspace) {
    throw new Error(`buildWorkspaceContext: workspace not found (${workspaceId})`);
  }

  // audience_profiles is seeded automatically per workspace (same trigger
  // as brand_voice), so a missing row here means the query itself failed,
  // not that the workspace opted out — still degrades gracefully rather
  // than blocking context building.
  const [brandVoice, audienceProfile, accounts] = await Promise.all([
    brandVoiceRepository.get(workspaceId).catch(() => null),
    audienceProfileRepository.get(workspaceId).catch(() => null),
    accountRepository.list(workspaceId).catch(() => []),
  ]);

  const platforms = accounts.filter((a) => a.status === 'connected').map((a) => a.platform);

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      brand_name: workspace.brand_name,
      timezone: workspace.timezone,
      language: workspace.language,
      country: workspace.country,
    },
    brand: brandVoice
      ? {
          business_name: brandVoice.business_name,
          description: brandVoice.description,
          industry: brandVoice.industry,
          writing_style: brandVoice.writing_style,
          tone: brandVoice.tone,
          preferred_words: brandVoice.keywords ?? [],
          forbidden_words: brandVoice.negative_keywords ?? [],
          cta_style: brandVoice.cta_style,
          emoji_policy: brandVoice.emoji_style ?? null,
          formality: brandVoice.formality,
          voice: brandVoice.voice,
          sentence_style: brandVoice.sentence_style,
          hook_style: brandVoice.hook_style,
          hashtag_policy: brandVoice.hashtag_policy,
          content_length: brandVoice.content_length,
          brand_values: brandVoice.brand_values ?? [],
          audience_relationship: brandVoice.audience_relationship,
        }
      : null,
    audience: {
      summary: brandVoice?.audience ?? null,
      persona: audienceProfile?.persona ?? null,
      pain_points: audienceProfile?.pain_points ?? [],
      desires: audienceProfile?.desires ?? [],
      motivations: audienceProfile?.motivations ?? [],
      objections: audienceProfile?.objections ?? [],
      awareness_level: audienceProfile?.awareness_level ?? null,
      interests: audienceProfile?.interests ?? [],
      preferred_content: audienceProfile?.preferred_content ?? [],
      language_style: audienceProfile?.language_style ?? null,
      purchase_intent: audienceProfile?.purchase_intent ?? null,
    },
    // Reserved for STEP 3 (Brand DNA) / STEP 4 (Audience Intelligence) /
    // STEP 6 (Strategy Agent) — intentionally empty until those steps add
    // somewhere real to source them from.
    business_goals: [],
    content_goals: [],
    content_pillars: [],
    platforms,
    language: workspace.language,
    restrictions: brandVoice?.negative_keywords ?? [],
    context_version: WORKSPACE_CONTEXT_VERSION,
  };
}
