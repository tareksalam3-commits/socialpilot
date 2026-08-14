import type { UsedContentSource } from './assistant';

// Phase 2 — STEP 2: Workspace Context.
//
// A single, structured object assembled from the EXISTING tables
// (workspaces, brand_voice, connected_accounts) that can be passed to any
// AI Orchestrator task instead of ad-hoc prompt strings. This is not a new
// database schema — it's a typed view over data that already exists.
//
// Several fields below are reserved for later Phase 2 steps and stay
// empty/optional until then, so this shape does not need to change again
// when those steps land:
//   - `brand`               -> STEP 3 (Brand DNA) done: full Brand DNA now
//                              included below (tone, formality, voice,
//                              sentence_style, hook_style, hashtag_policy,
//                              content_length, brand_values,
//                              audience_relationship, emoji_policy)
//   - `audience`            -> STEP 4 (Audience Intelligence) done: full
//                              structured persona now included below
//   - `business_goals` /
//     `content_goals` /
//     `content_pillars`     -> Strategy Agent (STEP 6) now exists (see
//                              ContentStrategy below) and is wired into the
//                              pipeline, but its output is not folded back
//                              into these WorkspaceContext arrays yet —
//                              that remains for whichever later step first
//                              needs a persisted/reusable strategy. STEP 6
//                              itself hands ContentStrategy straight to its
//                              caller instead.
//
// `context_version` lets STEP 28 (AI decision logging) record which shape
// of context produced a given result, without needing the full Learning
// Engine that's explicitly out of scope for Phase 2.

// 1 -> 2: STEP 3 (Brand DNA) expanded `brand`. 2 -> 3: STEP 4 (Audience
// Intelligence) expanded `audience`. Any AI decision logged (STEP 28)
// records this so results can be traced back to the context shape that
// produced them.
export const WORKSPACE_CONTEXT_VERSION = 3;

export type WorkspaceContextCore = {
  id: string;
  name: string;
  brand_name: string | null;
  timezone: string;
  language: string;
  country: string;
};

/** Full Brand DNA (Phase 2, STEP 3) — sourced from the `brand_voice` table,
 * which was extended in place rather than split into a second table. */
export type WorkspaceContextBrand = {
  business_name: string | null;
  description: string | null;
  industry: string | null;
  writing_style: string | null;
  tone: string | null;
  preferred_words: string[];
  forbidden_words: string[];
  cta_style: string | null;
  emoji_policy: string | null;
  formality: string | null;
  voice: string | null;
  sentence_style: string | null;
  hook_style: string | null;
  hashtag_policy: string | null;
  content_length: string | null;
  brand_values: string[];
  audience_relationship: string | null;
};

/** Full Audience Intelligence (Phase 2, STEP 4) — sourced from the
 * `audience_profiles` table. `summary` (brand_voice.audience free text)
 * is kept alongside the structured fields as a fallback for workspaces
 * that haven't filled in a structured persona yet. */
export type WorkspaceContextAudience = {
  summary: string | null;
  persona: string | null;
  pain_points: string[];
  desires: string[];
  motivations: string[];
  objections: string[];
  awareness_level: string | null;
  interests: string[];
  preferred_content: string[];
  language_style: string | null;
  purchase_intent: string | null;
};

export type WorkspaceContext = {
  workspace: WorkspaceContextCore;
  /** null when the workspace hasn't set up Brand Voice yet — callers
   * should treat this as "no brand context available", not an error. */
  brand: WorkspaceContextBrand | null;
  audience: WorkspaceContextAudience;
  business_goals: string[];
  content_goals: string[];
  content_pillars: string[];
  /** Platforms with an active (status === 'connected') account only. */
  platforms: string[];
  language: string;
  /** Hard constraints content must not violate — sourced from
   * brand_voice.negative_keywords (same list as brand.forbidden_words). */
  restrictions: string[];
  context_version: number;
};

/** Structured output of the Strategy Agent (Phase 2, STEP 6). Turns
 * Business Goal + Audience + Brand + Platform into a Content Strategy the
 * later agents (Content, Hook, Platform Adaptation — STEP 8+) can act on.
 * Every field is structured, never free-form prose, per the "Structured
 * Output" rule (STEP 26) — a strategy an agent can't safely destructure is
 * as unusable as no strategy at all. */
export type ContentStrategy = {
  objective: string;
  content_pillars: string[];
  angles: string[];
  formats: string[];
  /** Ordered, most important first — e.g. ["linkedin", "facebook"]. Always
   * a subset of the platforms actually passed into the Strategy Agent —
   * parsing never invents a platform that wasn't offered to it. */
  platform_priorities: string[];
  cta_strategy: string;
  recommended_frequency: string;
  success_metrics: string[];
};

/** Phase 2, STEP 9 — Hook Intelligence. A single generated hook candidate
 * (section 15: "ينتج عدة Hooks... كل Hook يحصل على attention_score/
 * clarity_score/curiosity_score/relevance_score/brand_fit/platform_fit ثم
 * اختيار الأفضل"). `total_score` is never trusted from the model — it's
 * always the average of the six sub-scores, computed in code, so the
 * "اختيار الأفضل" step is a deterministic argmax rather than the model
 * grading its own homework. */
export type HookCandidate = {
  text: string;
  attention_score: number;
  clarity_score: number;
  curiosity_score: number;
  relevance_score: number;
  brand_fit: number;
  platform_fit: number;
  total_score: number;
};

/** Phase 2, STEP 9 — Hook Agent output. `hooks` keeps every candidate (for
 * history/inspection); `best` is the one with the highest `total_score`,
 * or null when generation/parsing failed — same non-blocking contract as
 * ContentStrategy/ResearchResult: a Hook Agent failure never blocks Content
 * Generation, it just means the Creator falls back to writing its own hook
 * like it did before this step existed. */
export type HookAgentResult = {
  hooks: HookCandidate[];
  best: HookCandidate | null;
};

/** Phase 2, STEP 10 — Platform Intelligence. One platform's adaptation
 * rules (section 17: "لكل Platform Profile: platform/content_length/tone/
 * structure/hook_style/cta_style/hashtag_rules/media_requirements/
 * format_rules"). Kept as plain data (DEFAULT_PLATFORM_PROFILES in
 * platformAgent.ts) so it's "قابلة للتعديل مستقبلًا" — editable later
 * without touching the agent's logic. */
export type PlatformProfile = {
  platform: string;
  content_length: string;
  tone: string;
  structure: string;
  hook_style: string;
  cta_style: string;
  hashtag_rules: string;
  media_requirements: string;
  format_rules: string;
};

/** Phase 2, STEP 10 — Platform Adaptation Engine output. `master` is the
 * Creator Agent's original text (section 16's "Master Content"); `variants`
 * maps each requested platform id to its own adapted version — never the
 * same text reused across platforms ("لا تستخدم نفس النص لكل المنصات").
 * Only ever contains keys for platforms actually requested — parsing never
 * invents a platform that wasn't offered to it, same rule as Strategy's
 * platform_priorities. */
export type PlatformAdaptationResult = {
  master: string;
  variants: Record<string, string>;
};

/** Phase 2, STEP 7 — Research Decision. Most requests (a generic
 * brand-awareness post, a straightforward promo) never need research, so
 * this gate exists specifically to stop every content request from paying
 * for/waiting on a research pass — the Research Agent below only runs when
 * `research_required` is true. */
export type ResearchDecision = {
  research_required: boolean;
  reason: string;
  /** Which trigger categories matched, if any — a subset of:
   * time-sensitive, fact-heavy, statistical, news-related,
   * competitor-related, market-related, source-dependent. */
  categories: string[];
};

/** Phase 2, STEP 7 — Research Agent output. `research_available` is the
 * honest signal for whether real, non-invented grounding was actually
 * found for this request — a Research Agent that always reports "verified"
 * would defeat the point ("لا تخترع المصادر"). `sources` are always real
 * `UsedContentSource` rows pulled from the workspace's own Content Sources
 * (RSS/URLs/YouTube/files) — never a citation invented by the model. When
 * `research_available` is false, `evidence`/`sources` are empty and
 * `verified_context` is null; callers must treat that as "still needs a
 * human source check", not as cleared to publish — the gate that actually
 * enforces that is the AI Decision Layer (STEP 20/24), out of scope here. */
export type ResearchResult = {
  research_required: boolean;
  research_available: boolean;
  evidence: string[];
  sources: UsedContentSource[];
  verified_context: string | null;
  reason: string;
};

/** Phase 2, STEP 13 — AI Decision Layer (section 24). A central,
 * cross-cutting decision distinct from the Quality Decision Layer's
 * `QualityDecision` (STEP 11/section 21): where QualityDecision judges a
 * single piece of content, AIDecision judges a whole OPERATION (`task`) —
 * "قبل بعض العمليات المهمة يجب تقييم: task, context, risk, confidence,
 * quality" — folding in the operation's own risk (e.g. does it still need
 * Research that never actually landed?) on top of the content's own
 * quality verdict. Always computed in code (evaluateAIDecision in
 * decisionEngine/aiDecisionLayer.ts), never by asking the model to grade
 * its own risk — same principle as QualityDecision and HookCandidate's
 * total_score. */
export type AIDecisionLabel = 'EXECUTE' | 'RESEARCH' | 'REWRITE' | 'IMPROVE' | 'HUMAN_REVIEW' | 'ABORT';

/** Which "important operation" (section 24) this decision was evaluated
 * for. `draft_generation` covers the Content/Quality Engine's own
 * generate-then-review loop; `schedule_post` covers the Approve/Schedule
 * step in useAssistantPipeline's approveAndSchedule — the two points in
 * the current pipeline where an AI-authored draft is about to move
 * forward. Not an exhaustive/closed set — new tasks can be added as later
 * steps wire the layer into more operations. */
export type AIDecisionTask = 'draft_generation' | 'schedule_post';

export type AIDecisionRisk = 'low' | 'medium' | 'high';

export type AIDecision = {
  task: AIDecisionTask;
  decision: AIDecisionLabel;
  confidence: number;
  reason: string;
  risk: AIDecisionRisk;
};

/** Phase 3, STEP 5 — Content <-> Performance. The structured, queryable
 * snapshot of "what this post actually was" — written once at
 * approveAndSchedule() time from whatever ContentStrategy/HookCandidate
 * the run already produced (see useAssistantPipeline.ts). This is what
 * later Pattern Detection/Learning Memory steps join against
 * post_analytics on, instead of re-parsing free text.
 *
 * `content_pillar`/`format` are campaign-level (ContentStrategy proposes
 * several; the Creator/Hook Agents don't currently assign one specific
 * pillar per individual post in a multi-post run), so these are a
 * best-effort "primary" pick (first element) — the full strategy stays in
 * `source` for anyone who needs the complete list. Precise per-post
 * assignment is a later refinement, not pretended here. */
export type ContentCharacteristics = {
  post_id: string;
  workspace_id: string;
  topic: string | null;
  content_pillar: string | null;
  hook_type: string | null;
  hook_text: string | null;
  format: string | null;
  length_bucket: 'short' | 'medium' | 'long' | null;
  char_count: number | null;
  cta_type: string | null;
  tone: string | null;
  objective: string | null;
  audience_persona: string | null;
  platforms: string[];
  publishing_time: string | null;
  source: Record<string, unknown>;
};
