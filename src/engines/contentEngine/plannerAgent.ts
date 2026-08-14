import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import type { ChatMessage } from '@/types/ai';
import type { CampaignPlan, Cadence, CampaignStart } from '@/types/assistant';
import { stripFence } from './contentGuards';

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
Choose "platforms" only from this list of connected accounts: ${platformHint} — the user should never need to pick accounts manually, so infer every platform they mean (e.g. "Meta" means facebook and instagram) and include all of them that are connected. "post_count" default is 1 — a request describing a single topic or asking for "a post" / "منشور" (singular, no number, no plural like "منشورات", no word like "خطة"/"حملة"/"أفكار") must get post_count=1. Only raise it when the user gives an explicit number ("10 posts", "5 منشورات") or clearly asks for a plan/campaign/multiple ideas. Never invent a multi-post campaign out of a single-topic request. Keep it between 1 and 20. Set "use_content_sources" to true only if the user asks to pull from, summarize, or base content on their Content Sources (RSS feeds, URLs, PDFs, docs, spreadsheets, YouTube videos) — in Arabic this may read as "من مصادر المحتوى" أو "باستخدام مصادر المحتوى". Set "start" to "now" whenever the user asks for a near-immediate send — including a short relative delay like "بعد 5 دقائق" / "انشر بعد خمس دقائق" / "in 5 minutes" / "right now" — the exact minutes-from-now offset is applied automatically downstream, so "now" is the correct value for any such short-delay request, not just literally-instant ones. "notes" should capture tone, key talking points, or workflow instructions the Creator agent needs.`,
    },
    { role: 'user', content: request },
  ];
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

/** Deterministic backstop for post_count: an explicit number the user
 * actually typed (digit or Arabic number word, "4", "٤", "اربع منشورات",
 * "4 posts"...) must always be respected exactly — never left purely to
 * the Planner model's own counting, which is unreliable in both
 * directions (a single-topic ask inflated into a 5-post campaign, or an
 * explicit "4" undercounted to 3). When the request contains one, it
 * overrides whatever post_count the model returned. Returns null when no
 * explicit count is present, so the model's own value (or the post_count=1
 * default for an unspecified single request) is left alone. */
function extractExplicitPostCount(request: string): number | null {
  const normalized = request.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  // Prefer a number that's actually attached to "post(s)"/"منشور(ات)" context
  // — e.g. "4 منشورات" or "منشور 4" or "4 posts" — over any bare number
  // floating elsewhere in the request (a time, a date, an unrelated count),
  // which the second, looser pattern is a fallback for.
  const contextMatch = normalized.match(/\b([1-9]|1\d|20)\s*(?:منشور|منشورات|post|posts)\b/i)
    ?? normalized.match(/(?:منشور|منشورات|post|posts)\s*([1-9]|1\d|20)\b/i);
  if (contextMatch) return Number(contextMatch[1]);
  const digitMatch = normalized.match(/\b([1-9]|1\d|20)\b/);
  if (digitMatch) return Number(digitMatch[1]);

  const ARABIC_NUMBER_WORDS: Record<string, number> = {
    'واحد': 1, 'واحدة': 1,
    'اتنين': 2, 'إتنين': 2, 'اثنين': 2, 'اثنان': 2,
    'تلاتة': 3, 'ثلاثة': 3, 'تلات': 3, 'ثلاث': 3,
    'اربعة': 4, 'أربعة': 4, 'اربع': 4, 'أربع': 4,
    'خمسة': 5, 'خمس': 5,
    'ستة': 6, 'سته': 6, 'ست': 6,
    'سبعة': 7, 'سبع': 7,
    'تمانية': 8, 'ثمانية': 8, 'تمان': 8, 'ثماني': 8,
    'تسعة': 9, 'تسع': 9,
    'عشرة': 10, 'عشر': 10,
  };
  for (const [word, value] of Object.entries(ARABIC_NUMBER_WORDS)) {
    if (new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(normalized)) return value;
  }
  return null;
}

function parsePlan(raw: string, connectedPlatforms: string[], request?: string): CampaignPlan {
  const fallbackPlatforms = connectedPlatforms.length ? connectedPlatforms : DEFAULT_PLATFORMS;
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    const platforms = Array.isArray(json.platforms) && json.platforms.length
      ? (json.platforms as unknown[]).filter((p): p is string => typeof p === 'string')
      : fallbackPlatforms;
    const modelPostCount = Math.round(Number(json.post_count)) || DEFAULT_PLAN.post_count;
    const explicitCount = request ? extractExplicitPostCount(request) : null;
    const post_count = Math.min(20, Math.max(1, explicitCount ?? modelPostCount));
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

/** Runs the Planner Agent and returns a validated CampaignPlan. Falls back to
 * sane defaults (rather than failing the whole pipeline) if the model
 * response can't be parsed. */
export async function runPlannerAgent(
  workspaceId: string,
  request: string,
  connectedPlatforms: string[],
  aiSettings?: { model?: string; temperature?: number; maxTokens?: number; freeOnly?: boolean },
): Promise<{ plan: CampaignPlan; raw: string; error: string | null }> {
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages: buildPlannerMessages(request, connectedPlatforms),
      model: aiSettings?.model,
      temperature: 0.4,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: aiSettings?.freeOnly ?? true,
      brandVoice: null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_planner', input: request, output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    return { plan: parsePlan(result.content, connectedPlatforms, request), raw: result.content, error: null };
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
