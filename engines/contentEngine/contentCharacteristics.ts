import type { ContentStrategy, HookCandidate, WorkspaceContext, ContentCharacteristics } from '@/types/context';
import type { CampaignPlan } from '@/types/assistant';

// Phase 3, STEP 5 — Content <-> Performance. Turns whatever the run's
// Strategy/Hook Agents (Phase 2, STEP 6/9) actually produced into the
// queryable snapshot content_characteristics stores. Deterministic, no AI
// call of its own — section 25 reserves AI for interpretation, not for
// this kind of straight field mapping.

const LENGTH_SHORT_MAX = 120;
const LENGTH_MEDIUM_MAX = 500;

function lengthBucket(charCount: number): 'short' | 'medium' | 'long' {
  if (charCount <= LENGTH_SHORT_MAX) return 'short';
  if (charCount <= LENGTH_MEDIUM_MAX) return 'medium';
  return 'long';
}

// Best-effort classification only — HookCandidate carries scores, not a
// category, and there is no dedicated Hook Type agent yet. A handful of
// surface patterns cover the common cases; anything else stays null
// rather than guessing, since a wrong label is worse than no label for
// Pattern Detection downstream.
function classifyHookType(hookText: string | null): string | null {
  if (!hookText) return null;
  const text = hookText.trim();
  if (!text) return null;
  if (text.includes('؟') || text.includes('?')) return 'question';
  if (/^\d/.test(text) || /\d+%/.test(text)) return 'statistic';
  if (/^(تخيل|تخيلوا|imagine)/i.test(text)) return 'story';
  if (/^(لو|إذا|if you)/i.test(text)) return 'conditional';
  return 'statement';
}

export function buildContentCharacteristics(params: {
  postId: string;
  workspaceId: string;
  content: string;
  platforms: string[];
  plan: CampaignPlan;
  requestText: string;
  strategy: ContentStrategy | null;
  hook: HookCandidate | null;
  workspaceContext: WorkspaceContext | null;
  publishingTime: string | null;
}): ContentCharacteristics {
  const { postId, workspaceId, content, platforms, plan, requestText, strategy, hook, workspaceContext, publishingTime } = params;
  const charCount = content.length;

  return {
    post_id: postId,
    workspace_id: workspaceId,
    // No dedicated topic-extraction step exists yet — the user's own
    // request is the closest available signal until one does.
    topic: requestText?.trim() ? requestText.trim().slice(0, 300) : null,
    content_pillar: strategy?.content_pillars?.[0] ?? null,
    hook_type: classifyHookType(hook?.text ?? null),
    hook_text: hook?.text ?? null,
    format: strategy?.formats?.[0] ?? null,
    length_bucket: lengthBucket(charCount),
    char_count: charCount,
    cta_type: strategy?.cta_strategy?.trim() || null,
    tone: workspaceContext?.brand?.tone ?? null,
    objective: plan.objective ?? null,
    audience_persona: workspaceContext?.audience?.persona ?? plan.audience ?? null,
    platforms,
    publishing_time: publishingTime,
    source: {
      strategy,
      hook,
    },
  };
}
