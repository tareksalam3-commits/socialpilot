import type { PostStatus } from '@/types/social';
import type { AIDecision } from '@/types/context';

/** High-level stage the AI Assistant pipeline is currently in. Maps onto the
 * requested lifecycle (Request → Audience Inference → User Approval →
 * Content Generation → Quality Review → Preview → Schedule/Publish, which
 * itself sits inside the broader Draft → AI Generated → Reviewed → Approved
 * → Scheduled → Publishing → Published → Verified flow): 'planning' is the
 * Planner Agent, 'audience' is the Audience Inference step and pauses for
 * User Approval before anything is generated, 'collecting'/'creating'
 * produce the AI Generated content. 'quality' is a standalone Quality
 * Review stage — distinct from 'creating', not folded into it — that sits
 * between Content Generation and the Publisher Agent ('preparing'). Every
 * draft already ran through the Content Quality Control pass during
 * 'creating' (auto-fix + re-review, up to MAX_QC_ATTEMPTS); 'quality' is
 * where that per-draft pass/fail result is surfaced clearly (قيد المراجعة /
 * يحتاج تعديل / تم الاعتماد) and enforced as a hard gate: the pipeline only
 * advances to 'preparing' once every draft is `approved`, either
 * automatically (already all approved) or after the user fixes flagged
 * drafts and continues manually. There is no path from 'creating' to
 * 'preparing' that skips 'quality'. 'review' is Reviewed/Preview, clicking
 * Approve moves through 'scheduling' (Approved → Scheduled) into
 * 'monitoring', where each row tracks Publishing → Published → Verified via
 * the same posts / post_platform_targets rows the Posts, Calendar, Queue
 * and Automation pages already read from. */
export type AssistantCreationPhase = 'generating' | 'qc' | 'improving' | 'rechecking' | 'approved' | null;

export type AssistantStage =
  | 'idle'
  | 'planning'
  | 'audience'
  | 'collecting'
  | 'creating'
  | 'quality'
  | 'preparing'
  | 'review'
  | 'scheduling'
  | 'monitoring';

export type Cadence = 'daily' | 'every_other_day' | 'weekly' | 'once';
export type CampaignStart = 'now' | 'today' | 'tomorrow';

/** Output of the Planner Agent — what to make, for whom, on which
 * platforms, how many posts, and on what cadence. */
export type CampaignPlan = {
  objective: string;
  audience: string;
  platforms: string[];
  post_count: number;
  cadence: Cadence;
  start: CampaignStart;
  time_of_day: string; // "HH:MM", 24h
  notes: string;
  /** Whether the request implies pulling from the workspace's Content
   * Sources (e.g. "using Content Sources", "من مصادر المحتوى"). */
  use_content_sources: boolean;
};

/** Output of the Audience Inference agent — the AI's per-post guess at who
 * THIS specific post should target, derived from the workspace's
 * professional identity/Brand Voice context plus this post's own goal,
 * topic, and platform. Never a static value copied straight from Brand
 * Voice's own `audience` field (that's only ever one weak signal among
 * several) and never persisted anywhere as a fixed audience — it's
 * recomputed fresh for every request. `confidence` is 0–1; below
 * AUDIENCE_MIN_CONFIDENCE the suggestion is surfaced as "needs review"
 * rather than presented as a settled fact. The user's one-tap "Approve" or
 * free-text "Change" always has the final say — this is a suggestion, not
 * an autonomous decision. */
export type AudienceInference = {
  audience: string;
  reason: string;
  confidence: number;
};

/** A single content-source item that was folded into this campaign's
 * generation context, surfaced in the review screen for transparency. */
export type UsedContentSource = {
  source_id: string;
  source_name: string | null;
  title: string;
};

/** Phase 2, STEP 21 — the Quality Decision Layer's verdict on a single
 * piece of content. `decision` is always computed deterministically in
 * code (computeQualityDecision in contentGuards.ts) from the QC result —
 * never trusted from the model's own opinion of itself, same principle as
 * `total_score`/`platform_priorities` elsewhere in Phase 2. `confidence` is
 * 0–1. */
export type QualityDecisionLabel = 'APPROVE' | 'IMPROVE' | 'REWRITE' | 'RESEARCH' | 'HUMAN_REVIEW' | 'REJECT';
export type QualityDecision = {
  decision: QualityDecisionLabel;
  reason: string;
  confidence: number;
  issues: string[];
  recommendations: string[];
};

/** QC Hardening Pass (Aug 2026) — the twelve real quality dimensions (A-L)
 * every piece of content is judged on, replacing "trust the model's overall
 * number" with per-dimension evidence the Rewrite Agent can act on. Mapped
 * 1:1 to the brief: idea_value=A, hook=B, substance=C, structure=D,
 * arabic_quality=E, naturalness=F, brand_fit=G, audience_fit=H,
 * platform_fit=I, cta=J, originality=K, factual_logical=L. */
export type QualityDimensionKey =
  | 'idea_value'
  | 'hook'
  | 'substance'
  | 'structure'
  | 'arabic_quality'
  | 'naturalness'
  | 'brand_fit'
  | 'audience_fit'
  | 'platform_fit'
  | 'cta'
  | 'originality'
  | 'factual_logical';

/** Legacy rubric keys retained for the repository's deterministic calibration suite. */
export type LegacyQualityDimensionKey =
  | 'objective_score'
  | 'audience_score'
  | 'brand_score'
  | 'platform_score'
  | 'language_score'
  | 'clarity_score'
  | 'readability_score'
  | 'hook_score'
  | 'value_score'
  | 'cta_score'
  | 'originality_score'
  | 'factual_score'
  | 'safety_score';

/** Legacy per-dimension evidence record used by the deterministic rubric calibration. */
export type QualityDimensionEvidence = {
  dimension: QualityDimensionKey | LegacyQualityDimensionKey;
  score: number;
  reason: string;
  suggested_fix: string;
};

/** The six dimensions that alone can fail a piece of content no matter how
 * high every other score (or the overall average) is — the "Critical
 * Dimension Gate". A weak idea, a weak hook, broken Arabic, a robotic/
 * AI-sounding voice, an off-brand piece, or content that doesn't actually
 * fit the target platform is disqualifying on its own; it is never
 * something a few high scores elsewhere should be able to average away. */
export const CRITICAL_QUALITY_DIMENSIONS: readonly QualityDimensionKey[] = [
  'idea_value',
  'hook',
  'arabic_quality',
  'naturalness',
  'brand_fit',
  'platform_fit',
];

/** Per-dimension verdict — score is one signal among four; `evidence` +
 * `suggested_fix` are what actually let the Rewrite Agent (or a human)
 * target the real defect instead of re-rolling blind. `status` is written
 * by the QC model but never trusted on its own — evaluateContentApproval
 * always recomputes pass/fail from `score` against the dimension's own
 * threshold in code. */
export type QualityDimensionResult = {
  score: number;
  status: 'pass' | 'fail';
  reason: string;
  evidence: string;
  suggested_fix: string;
};

/** Result of the Arabic Content Quality Control pass (reviewGeneratedContent
 * in qualityControl.ts). `score` is always RECOMPUTED in code as the mean of
 * the twelve `dimensions` scores (see qualityControl.ts) — the model's own
 * self-reported overall number is logged for visibility only and never
 * trusted, precisely so "95+95+95+60" can no longer average out to a
 * passing score. `approved` is likewise never read from the model's own
 * `approved` flag: it is always recomputed by evaluateContentApproval from
 * the dimension scores + critical_issues, since the Authoring/QC model is
 * never allowed to grade its own work as acceptable (see excludeModel in
 * reviewGeneratedContent). The flat `*_score`/`arabic_quality`/
 * `linkedin_fit`/`brand_fit` fields below are kept for backward
 * compatibility with existing UI and are always derived from `dimensions`. */
export type ContentQualityResult = {
  approved: boolean;
  score: number;
  /** Legacy rubric score fields retained for compatibility with existing calibration checks. */
  objective_score?: number;
  audience_score?: number;
  value_score?: number;
  safety_score?: number;
  issues: string[];
  suggestions: string[];
  arabic_quality?: number;
  linkedin_fit?: number;
  brand_fit?: number;
  /** Phase 2, STEP 11 (Smart Quality Engine) — kept for backward
   * compatibility with existing UI reads; always mirrors `dimensions`. */
  hook_score?: number;
  clarity_score?: number;
  relevance_score?: number;
  brand_score?: number;
  platform_score?: number;
  language_score?: number;
  cta_score?: number;
  originality_score?: number;
  factual_score?: number;
  readability_score?: number;
  /** New dimensions added by the QC Hardening Pass that had no flat-field
   * equivalent before: A (idea/value), C (substance vs. filler), D
   * (structure/readability of organization), F (naturalness — distinct
   * from E's dialect-correctness: does it *read* human, not just is it
   * grammatically the right dialect), H (audience fit). */
  content_value_score?: number;
  substance_score?: number;
  structure_score?: number;
  naturalness_score?: number;
  audience_fit_score?: number;
  /** The full per-dimension evidence record (A-L) — score/status/reason/
   * evidence/suggested_fix for every QualityDimensionKey the QC model
   * evaluated. Source of truth for `score`/`approved` and for the Rewrite
   * Agent's brief; the flat fields above are a projection of this. */
  dimensions?: Partial<Record<QualityDimensionKey, QualityDimensionResult>>;
  /** Legacy evidence array retained while older rubric consumers migrate to dimensions. */
  dimension_evidence?: QualityDimensionEvidence[];
  /** Section 20 — Critical Issues. A restricted set (never free-form
   * labels the model invents). Any entry here blocks approval regardless
   * of `score`. Expanded by the QC Hardening Pass beyond the original five
   * (factual_error, brand_violation, forbidden_term, platform_violation,
   * unsafe_content) to also cover the Hard Fail Rules from item 5 of the
   * brief that aren't already a dimension-score gate on their own:
   * generic_content, unnatural_cta, ai_generated_style, length_mismatch. */
  critical_issues?: string[];
  /** Section 21 — the Quality Decision Layer's verdict for this pass,
   * computed in code (see QualityDecision above). */
  decision?: QualityDecision;
};

/** A single post prepared by the Creator Agent and staged by the
 * Publisher Agent for human review before anything is saved. */
export type DraftPost = {
  local_id: string;
  /** سجل المحتوى المحفوظ فور توليده في جدول posts. */
  post_id?: string;
  content: string;
  platforms: string[];
  scheduled_for: string; // ISO datetime
  media_urls: string[];
  generating?: boolean;
  /** Outcome of the last Arabic Content Quality Control pass run against
   * `content`. Null/undefined means QC hasn't run yet (or was unavailable). */
  quality?: ContentQualityResult | null;
  /** True once QC has run out of regeneration attempts (max 3) and the
   * content is still below the quality bar — shown as a "Needs Manual
   * Review" badge, never as an approved/high-quality result. The user can
   * still edit and approve manually. */
  needsReview?: boolean;
  /** True when the content is fully approved: the Deterministic Guard
   * passed, QC parsed successfully, and every score cleared its minimum.
   * False (never assumed true) whenever QC was unavailable or any
   * threshold wasn't met — see evaluateContentApproval(). */
  approved?: boolean;
  /** True when QC itself failed to run or failed to parse (network error,
   * malformed JSON, etc.) — distinct from QC running and rejecting the
   * content. Never auto-approved in this case. */
  quality_error?: boolean;
  /** The exact content string `quality` was computed for. Used to detect
   * manual edits so QC re-runs before Approval only when the text actually
   * changed since the last review (per the "don't run QC on every small
   * edit" rule). */
  reviewedContent?: string;
  /** True when validateFinalPostContent() rejected this draft's current
   * content on the last Approve attempt — surfaced in the review UI with
   * the reasons. There is no override: the draft must be edited (which
   * re-runs this same Final Quality Check) or regenerated before it can
   * be scheduled — Quality FAIL always blocks scheduling. */
  validationFailed?: boolean;
  /** Reasons from the last validateFinalPostContent() failure, shown to
   * the user so they know what to fix. */
  validationReasons?: string[];
  /** Phase 2, STEP 10 (Platform Adaptation Engine) — one distinct adapted
   * version of `content` per target platform, keyed by platform id. Never
   * required: a platform missing from this map (or the map being empty/
   * undefined entirely) means no adapted version was produced for it yet,
   * and `content` — the Master Content — is what's actually published for
   * every platform in `platforms`, exactly as before this step. Consuming
   * these per-platform versions in the UI/publishing path is STEP 14. */
  platformVariants?: Record<string, string>;
  /** Phase 2, STEP 13 (AI Decision Layer, section 24) — the central
   * Decision Layer's verdict for this draft, computed deterministically
   * from `quality.decision` (STEP 11) plus operation-level risk/context
   * (see evaluateAIDecision in decisionEngine/aiDecisionLayer.ts) — never
   * the model grading its own risk. Purely informational/traceable at this
   * point: it does not gate whether the draft can be scheduled —
   * validateFinalPostContent remains the only hard gate before scheduling,
   * exactly as before this step. Null/undefined means it hasn't been
   * computed yet for this draft's current content. */
  aiDecision?: AIDecision | null;
};

/** Tracks a post that has been approved, saved to the Posts module, and
 * is now being monitored through the existing publishing pipeline. Also
 * doubles as its entry in the Calendar and the Publishing Queue, since
 * those pages read the same `posts` row live — there is nothing separate
 * to "add" it to. `verified` flips once every platform target for the post
 * has confirmed an external ID (see verifyPost in assistantOrchestrator). */
export type MonitoredPost = {
  postId: string;
  title: string;
  status: PostStatus;
  error_message: string | null;
  verified: boolean;
};
