import { aiGateway } from '@/services/aiGateway';
import { mediaRepository } from '@/repositories/mediaRepository';
import type { MediaItem } from '@/types/social';
import type { CampaignPlan } from '@/types/assistant';

/** The "Create Images" step of the pipeline. Only called when the Media
 * Library has no usable match (findMatchingMedia comes back empty) and the
 * user enabled image generation — the assistant prefers reusing existing
 * brand assets over generating new ones. Saves the result through
 * mediaRepository.create so the generated image is a normal Media Library
 * item afterwards (searchable, reusable, deletable) rather than a one-off
 * URL only this campaign knows about. Never throws — a failed image
 * generation should degrade to "no image" rather than break the post. */
export async function generateDraftImage(
  workspaceId: string,
  plan: CampaignPlan,
  postContent: string,
): Promise<{ url: string | null; error: string | null }> {
  const prompt = `Professional, brand-safe social media photo. Campaign: ${plan.objective}. Audience: ${plan.audience}. Context: ${postContent.slice(0, 200)}. No embedded text, no watermark, no logos.`;
  try {
    const { url } = await aiGateway.generateImage({ workspaceId, prompt, width: 1024, height: 1024 });
    mediaRepository
      .create({ workspace_id: workspaceId, name: `${plan.objective.slice(0, 40) || 'AI campaign'} — AI image`, type: 'image', url, tags: ['ai-generated', 'assistant'] })
      .catch(() => {});
    return { url, error: null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : 'Image generation failed' };
  }
}

/** Best-effort image match against the workspace Media Library — the
 * assistant never fabricates images, it only reuses what's already
 * uploaded, keyed off simple keyword overlap with the post content. */
export function findMatchingMedia(text: string, media: MediaItem[]): string | null {
  const words = text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  if (words.length === 0) return null;
  const wordSet = new Set(words);
  let best: { url: string; score: number } | null = null;
  for (const item of media) {
    if (item.type !== 'image') continue;
    const haystack = `${item.name} ${item.tags.join(' ')}`.toLowerCase();
    let score = 0;
    for (const w of wordSet) if (haystack.includes(w)) score++;
    if (score > 0 && (!best || score > best.score)) best = { url: item.url, score };
  }
  return best?.url ?? null;
}
