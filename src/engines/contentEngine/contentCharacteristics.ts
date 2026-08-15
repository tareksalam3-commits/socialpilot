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

// Pattern Detection (detect_content_patterns, migration
// 20260811020000) GROUPs BY the raw content_pillar/format/cta_type column
// value for exact string equality. The Strategy Agent returns free-form
// text for `formats`/`cta_strategy` that is re-phrased by the model on
// every single run — even for the same underlying idea, e.g. "منشور
// تعليمي قصير" one run vs "بوست تعليمي مختصر" the next — so those two rows
// would never match in a GROUP BY and this dimension would silently never
// accumulate the sample_size the learning cycle needs, forever, with no
// error anywhere. classifyFormat/classifyCtaType exist to bucket the raw
// text into a small fixed vocabulary at write time, the same fix already
// applied to hook_type above, so patterns for these two dimensions can
// actually reach critical mass. `format`/`cta_strategy` free text is still
// kept verbatim in `source` for humans reading a post's characteristics —
// only the queryable column gets bucketed.
const FORMAT_BUCKETS: Array<{ key: string; test: RegExp }> = [
  { key: 'list_tips', test: /(نصائح|خطوات|قائمة|tips|list|checklist)/i },
  { key: 'question_poll', test: /(سؤال|استطلاع|صوّت|poll|survey)/i },
  { key: 'story', test: /(قصة|حكاية|تجربة|story|case study)/i },
  { key: 'before_after', test: /(قبل.*بعد|before.*after)/i },
  { key: 'testimonial', test: /(شهادة|رأي عميل|testimonial|review)/i },
  { key: 'behind_scenes', test: /(خلف الكواليس|behind the scenes)/i },
  { key: 'announcement', test: /(إعلان|إطلاق|announcement|launch)/i },
  { key: 'promotional', test: /(عرض|خصم|promo|offer|discount)/i },
  { key: 'educational', test: /(تعليم|شرح|معلومة|educational|how[- ]?to)/i },
  { key: 'motivational', test: /(تحفيز|إلهام|motivational|inspirational)/i },
];

function classifyFormat(formatText: string | null): string | null {
  if (!formatText) return null;
  const text = formatText.trim();
  if (!text) return null;
  for (const bucket of FORMAT_BUCKETS) if (bucket.test.test(text)) return bucket.key;
  return 'other';
}

const CTA_BUCKETS: Array<{ key: string; test: RegExp }> = [
  { key: 'comment_engagement', test: /(علّق|شاركنا رأيك|اكتب في الكومنت|comment below)/i },
  { key: 'dm_inquiry', test: /(راسلنا|ابعت رسالة|DM|inbox)/i },
  { key: 'book_consultation', test: /(احجز|استشارة|book a call|schedule)/i },
  { key: 'link_click', test: /(رابط|بايو|link in bio|click the link|زور الموقع)/i },
  { key: 'save_share', test: /(احفظ|شارك المنشور|save this|share this)/i },
  { key: 'purchase_offer', test: /(اطلب الآن|اشترِ|order now|buy now|شراء)/i },
  { key: 'follow_subscribe', test: /(تابعنا|اشترك|follow us|subscribe)/i },
];

function classifyCtaType(ctaText: string | null): string | null {
  if (!ctaText) return null;
  const text = ctaText.trim();
  if (!text) return null;
  for (const bucket of CTA_BUCKETS) if (bucket.test.test(text)) return bucket.key;
  return 'other';
}

// content_pillar can't be bucketed into a fixed universal vocabulary like
// format/CTA — pillars are genuinely business-specific ("عقارات فاخرة" vs
// "وصفات أكل صحي" aren't the same axis). The real fix for pattern-matching
// is upstream in strategyAgent.ts (reusing this workspace's own past
// pillars instead of re-coining one each run); this just strips
// incidental whitespace/punctuation drift so two runs that *did* return
// the same pillar name don't fail to match over a stray space or period.
function normalizePillar(pillar: string | null): string | null {
  if (!pillar) return null;
  const text = pillar.trim().replace(/\s+/g, ' ').replace(/[.。،,]+$/g, '');
  return text || null;
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
    content_pillar: normalizePillar(strategy?.content_pillars?.[0] ?? null),
    hook_type: classifyHookType(hook?.text ?? null),
    hook_text: hook?.text ?? null,
    format: classifyFormat(strategy?.formats?.[0] ?? null),
    length_bucket: lengthBucket(charCount),
    char_count: charCount,
    cta_type: classifyCtaType(strategy?.cta_strategy ?? null),
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
