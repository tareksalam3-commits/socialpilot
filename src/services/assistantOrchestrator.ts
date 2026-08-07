import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import { contentSourceRepository } from '@/repositories/contentSourceRepository';
import { contentExtraction } from '@/services/contentExtraction';
import { postRepository } from '@/repositories/postRepository';
import { mediaRepository } from '@/repositories/mediaRepository';
import type { ChatMessage } from '@/types/ai';
import type { MediaItem } from '@/types/social';
import type { CampaignPlan, Cadence, CampaignStart, UsedContentSource } from '@/types/assistant';

const CADENCE_VALUES: Cadence[] = ['daily', 'every_other_day', 'weekly', 'once'];
const START_VALUES: CampaignStart[] = ['now', 'today', 'tomorrow'];
const DEFAULT_PLATFORMS = ['facebook', 'instagram', 'linkedin'];

export const DEFAULT_PLAN: CampaignPlan = {
  objective: 'General brand awareness',
  audience: 'General audience',
  platforms: DEFAULT_PLATFORMS,
  post_count: 3,
  cadence: 'daily',
  start: 'tomorrow',
  time_of_day: '09:00',
  notes: '',
  use_content_sources: false,
};

function stripFence(text: string): string {
  return text
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

/** Builds the Planner Agent's prompt. It must respond with strict JSON only —
 * the Planner's whole job is to turn a free-text request into a structured
 * campaign brief that the Creator and Publisher agents can act on. */
function buildPlannerMessages(request: string, connectedPlatforms: string[]): ChatMessage[] {
  const platformHint = connectedPlatforms.length ? connectedPlatforms.join(', ') : DEFAULT_PLATFORMS.join(', ');
  return [
    {
      role: 'system',
      content: `You are the Planner agent inside a social media automation assistant. Read the user's campaign request and respond with ONLY strict, minified JSON — no markdown fences, no commentary, no trailing text. The JSON must have exactly these fields:
{"objective": string, "audience": string, "platforms": string[], "post_count": number, "cadence": "daily"|"every_other_day"|"weekly"|"once", "start": "now"|"today"|"tomorrow", "time_of_day": "HH:MM", "notes": string, "use_content_sources": boolean}
Choose "platforms" only from this list of connected accounts: ${platformHint} — the user should never need to pick accounts manually, so infer every platform they mean (e.g. "Meta" means facebook and instagram) and include all of them that are connected. Keep "post_count" between 1 and 20 to match explicit requests like "10 posts". Set "use_content_sources" to true only if the user asks to pull from, summarize, or base content on their Content Sources (RSS feeds, URLs, PDFs, docs, spreadsheets, YouTube videos) — in Arabic this may read as "من مصادر المحتوى" or "باستخدام مصادر المحتوى". "notes" should capture tone, key talking points, or workflow instructions the Creator agent needs.`,
    },
    { role: 'user', content: request },
  ];
}

/** Runs the Planner Agent and returns a validated CampaignPlan. Falls back to
 * sane defaults (rather than failing the whole pipeline) if the model
 * response can't be parsed. */
export async function runPlannerAgent(
  workspaceId: string,
  request: string,
  connectedPlatforms: string[],
  aiSettings?: { model?: string; temperature?: number; maxTokens?: number },
): Promise<{ plan: CampaignPlan; raw: string; error: string | null }> {
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages: buildPlannerMessages(request, connectedPlatforms),
      model: aiSettings?.model,
      temperature: 0.4,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: true,
      brandVoice: null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_planner', input: request, output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    return { plan: parsePlan(result.content, connectedPlatforms), raw: result.content, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Planning failed';
    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_planner', input: request, output: null, model: null, status: 'failed' })
      .catch(() => {});
    return {
      plan: { ...DEFAULT_PLAN, platforms: connectedPlatforms.length ? connectedPlatforms : DEFAULT_PLATFORMS },
      raw: '',
      error: message,
    };
  }
}

/** The user should never have to hand-pick social accounts — the plan's
 * platforms are always narrowed down to accounts that are actually
 * connected. If the model picked something unconnected (or nothing usable),
 * every connected platform is used instead, since that's the safest
 * interpretation of "publish on my connected accounts". */
function resolveConnectedPlatforms(requested: string[], connectedPlatforms: string[]): string[] {
  if (connectedPlatforms.length === 0) return requested;
  const matched = requested.filter((p) => connectedPlatforms.includes(p));
  return matched.length ? matched : connectedPlatforms;
}

function parsePlan(raw: string, connectedPlatforms: string[]): CampaignPlan {
  const fallbackPlatforms = connectedPlatforms.length ? connectedPlatforms : DEFAULT_PLATFORMS;
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    const platforms = Array.isArray(json.platforms) && json.platforms.length
      ? (json.platforms as unknown[]).filter((p): p is string => typeof p === 'string')
      : fallbackPlatforms;
    const post_count = Math.min(20, Math.max(1, Math.round(Number(json.post_count)) || DEFAULT_PLAN.post_count));
    const cadence = CADENCE_VALUES.includes(json.cadence as Cadence) ? (json.cadence as Cadence) : DEFAULT_PLAN.cadence;
    const start = START_VALUES.includes(json.start as CampaignStart) ? (json.start as CampaignStart) : DEFAULT_PLAN.start;
    const time_of_day = typeof json.time_of_day === 'string' && /^\d{2}:\d{2}$/.test(json.time_of_day) ? json.time_of_day : DEFAULT_PLAN.time_of_day;
    return {
      objective: typeof json.objective === 'string' && json.objective.trim() ? json.objective.trim() : DEFAULT_PLAN.objective,
      audience: typeof json.audience === 'string' && json.audience.trim() ? json.audience.trim() : DEFAULT_PLAN.audience,
      platforms: resolveConnectedPlatforms(platforms.length ? platforms : fallbackPlatforms, connectedPlatforms),
      post_count,
      cadence,
      start,
      time_of_day,
      notes: typeof json.notes === 'string' ? json.notes.trim() : '',
      use_content_sources: json.use_content_sources === true,
    };
  } catch {
    return { ...DEFAULT_PLAN, platforms: fallbackPlatforms };
  }
}

/** Runs the "collect information from Content Sources" step of the pipeline.
 * Reuses the existing Content Sources module end-to-end — the same
 * content-extraction Edge Function the Content Sources page calls already
 * fetches, cleans, and summarizes each source, so this just gathers those
 * summaries into one block of grounding text for the Creator agent (passed
 * on as `contentText`, the same field the Content Studio's "ground in
 * source" feature already uses). Never throws — a source hiccup should
 * degrade to "no extra context" rather than break the whole campaign. */
export async function collectContentContext(
  workspaceId: string,
): Promise<{ contentText: string | null; used: UsedContentSource[]; error: string | null }> {
  try {
    const sources = await contentSourceRepository.list(workspaceId);
    if (sources.length === 0) {
      return { contentText: null, used: [], error: 'no_sources' };
    }
    const { items } = await contentExtraction.fetchNewContent(workspaceId);
    const relevant = items.filter((i) => i.relevant).slice(0, 8);
    if (relevant.length === 0) {
      return { contentText: null, used: [], error: 'no_new_items' };
    }
    const contentText = relevant
      .map((i) => `- ${i.title}${i.source_name ? ` (${i.source_name})` : ''}: ${i.summary}`)
      .join('\n');
    const used: UsedContentSource[] = relevant.map((i) => ({ source_id: i.source_id, source_name: i.source_name, title: i.title }));
    return { contentText, used, error: null };
  } catch (e) {
    return { contentText: null, used: [], error: e instanceof Error ? e.message : 'content_sources_failed' };
  }
}

/** Builds the Creator Agent's prompt for a single post within the campaign.
 * Brand voice, hashtags, and CTA are all requested inline so the returned
 * text is ready to publish as-is. */
function buildCreatorMessages(plan: CampaignPlan, index: number): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You are the Creator agent inside a social media automation assistant. Write ONE complete, ready-to-publish social media post. Output ONLY the final post text — no explanations, no markdown fences, no numbering or labels. Include a strong hook, a concise body, relevant hashtags placed naturally (where appropriate for the platform), and a clear call-to-action.`,
    },
    {
      role: 'user',
      content: `Campaign objective: ${plan.objective}\nTarget audience: ${plan.audience}\nPlatform(s): ${plan.platforms.join(' + ')}\nAdditional notes: ${plan.notes || 'none'}\nThis is post ${index + 1} of ${plan.post_count} in the campaign — keep it on-theme but distinct from the other posts.`,
    },
  ];
}

/** Runs the Creator Agent for a single post, applying the workspace's Brand
 * Voice exactly the way every other AI surface in the app does. */
export async function runCreatorAgent(
  workspaceId: string,
  plan: CampaignPlan,
  index: number,
  aiSettings?: { model?: string; temperature?: number; maxTokens?: number },
  contentText?: string | null,
): Promise<{ content: string; error: string | null }> {
  let brandVoice = null as Awaited<ReturnType<typeof brandVoiceRepository.get>>;
  try {
    brandVoice = await brandVoiceRepository.get(workspaceId);
  } catch {
    // brand voice is optional
  }

  const messages = buildCreatorMessages(plan, index);
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages,
      model: aiSettings?.model,
      temperature: aiSettings?.temperature ?? 0.8,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: true,
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

    return { content: result.content.trim(), error: null };
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
    return { content: '', error: message };
  }
}

/** The Publisher Agent's scheduling math — turns a cadence + start time into
 * one send time per post. Pure function, no AI call needed. */
export function computeScheduleTimes(plan: CampaignPlan, count: number): Date[] {
  const now = new Date();
  const [hh, mm] = plan.time_of_day.split(':').map((n) => parseInt(n, 10));
  let base = new Date(now);
  base.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);

  if (plan.start === 'now') {
    base = new Date(now.getTime() + 2 * 60 * 1000);
  } else if (plan.start === 'tomorrow' || base <= now) {
    base.setDate(base.getDate() + 1);
  }

  const stepDays = plan.cadence === 'daily' ? 1 : plan.cadence === 'every_other_day' ? 2 : plan.cadence === 'weekly' ? 7 : 0;

  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    if (plan.cadence === 'once') {
      d.setMinutes(d.getMinutes() + i * 30);
    } else {
      d.setDate(d.getDate() + i * stepDays);
    }
    times.push(d);
  }
  return times;
}

/** The last lifecycle step, Verified: confirms every platform target for a
 * published post actually has a stored external (platform) post ID before
 * calling it done — reusing the same post_platform_targets rows the
 * Publishing Engine already wrote external_id/published_at into rather than
 * calling any platform API again. Returns false while any target is still
 * pending/publishing so the caller can keep polling. */
export async function verifyPost(postId: string): Promise<boolean> {
  const targets = await postRepository.getTargets(postId);
  if (targets.length === 0) return false;
  return targets.every((t) => t.status === 'published' && !!t.external_id);
}

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
