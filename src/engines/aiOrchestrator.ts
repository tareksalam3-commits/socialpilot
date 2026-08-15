// AI Orchestrator — the layer between the app's UI and the two engines it
// coordinates for every AI Assistant run: Content Engine (planning, drafting,
// audience inference) and Quality Engine (QC scoring/approval loop). This
// file stays a thin barrel re-export so every existing import path below
// keeps working unchanged; the real logic lives in the engine folders.
//
// Content Engine  (./contentEngine/):
//   contentGuards.ts      — sanitizeGeneratedContent, arabicNaturalnessGuard,
//                            evaluateContentApproval, validateFinalPostContent
//   arabicWritingRules.ts — buildArabicWritingRules, isLinkedInPlatform,
//                            LINKEDIN_WRITING_RULES, OUTPUT_CONTRACT
//   plannerAgent.ts        — DEFAULT_PLAN, runPlannerAgent
//   audienceAgent.ts       — AUDIENCE_MIN_CONFIDENCE, runAudienceInferenceAgent
//   contentContext.ts      — collectContentContext (Content Sources grounding)
//   creatorAgent.ts         — runCreatorAgent (Phase 2, STEP 8: takes
//                             WorkspaceContext/ContentStrategy/ResearchResult
//                             and folds them into the prompt as Brand DNA +
//                             Audience Intelligence + Strategy + Research;
//                             STEP 9 adds an optional HookCandidate that
//                             directs the post's opening line)
//   rewriteAgent.ts         — runRewriteAgent (Phase 2, STEP 12 — Smart
//                             Rewrite: only runs after a draft fails
//                             Quality Control; takes the failing content +
//                             Quality Report + Failed Dimensions + Brand DNA
//                             + Audience + Platform Rules and produces a
//                             targeted fix, never a blind re-roll of
//                             runCreatorAgent — see file header)
//   scheduling.ts           — computeScheduleTimes, verifyPost
//   media.ts                — generateDraftImage, findMatchingMedia
//
// Quality Engine  (./qualityEngine/):
//   qualityControl.ts      — MAX_QC_ATTEMPTS, reviewGeneratedContent, runQualityControlLoop
//                             (Phase 2, STEP 11 — Smart Quality Engine:
//                             reviewGeneratedContent now also parses section
//                             19's extra Quality Dimensions + section 20's
//                             Critical Issues, and attaches a
//                             computeQualityDecision() verdict)
//
// Context Engine  (./contextEngine/)  — Phase 2, STEP 2:
//   workspaceContext.ts    — buildWorkspaceContext (structured Workspace Context)
//
// Decision Engine  (./decisionEngine/)  — Phase 2, STEP 13:
//   aiDecisionLayer.ts     — evaluateAIDecision (section 24 — turns
//                             the Quality Decision Layer's per-content
//                             verdict + operation-level risk/context into
//                             EXECUTE/RESEARCH/REWRITE/IMPROVE/HUMAN_REVIEW/
//                             ABORT for a given task), recordAIDecision
//                             (section 28 — logs every decision to the
//                             existing ai_history table for traceability)
//
// Strategy Agent  (./contentEngine/strategyAgent.ts) — Phase 2, STEP 6:
//   runStrategyAgent       — turns Business Goal + Audience + Brand + Platform
//                             into a structured ContentStrategy
//
// Research Decision + Research Agent  (./contentEngine/researchAgent.ts) —
// Phase 2, STEP 7:
//   runResearchDecision    — classifies whether this request needs research
//   runResearchAgent       — when required, grounds Evidence/Sources/Verified
//                             Context in the workspace's own Content Sources
//                             (never invents citations — see file header)
//
// Trend Signal  (./contentEngine/trendAgent.ts):
//   runTrendSignal          — optional open-web search (via the trend-search
//                             Edge Function / Tavily) for what's currently
//                             relevant to this post's topic/industry.
//                             Deliberately separate from the Research Agent
//                             above, which stays strictly grounded in the
//                             workspace's own Content Sources — this is a
//                             different, explicitly-hedged "consider, don't
//                             cite" signal (see renderTrendSignalBlock).
//                             No trend_search_api_key configured -> no
//                             effect on generation at all.
//
// Hook Agent  (./contentEngine/hookAgent.ts) — Phase 2, STEP 9:
//   runHookAgent           — generates several scored hook candidates and
//                             deterministically selects the best one (never
//                             trusts the model's own pick); the winner is
//                             handed to the Content Agent as an opening-line
//                             directive, same optional/additive role as
//                             Strategy and Research there.
//
// Platform Adaptation Engine  (./contentEngine/platformAgent.ts) —
// Phase 2, STEP 10:
//   runPlatformAdaptationAgent — turns the approved Master Content into a
//                             distinct version per target platform, each
//                             following that platform's Platform Profile
//                             (DEFAULT_PLATFORM_PROFILES/getPlatformProfile).
//                             Result is stored on the draft
//                             (DraftPost.platformVariants) but does not yet
//                             change what gets published — that's STEP 14.

export {
  sanitizeGeneratedContent,
  arabicNaturalnessGuard,
  evaluateContentApproval,
  computeQualityDecision,
  validateFinalPostContent,
} from './contentEngine/contentGuards';

export {
  isLinkedInPlatform,
  buildArabicWritingRules,
  EGYPTIAN_ARABIC_WRITING_RULES,
} from './contentEngine/arabicWritingRules';

export { DEFAULT_PLAN, runPlannerAgent } from './contentEngine/plannerAgent';

export { AUDIENCE_MIN_CONFIDENCE, runAudienceInferenceAgent } from './contentEngine/audienceAgent';

export { runStrategyAgent } from './contentEngine/strategyAgent';

export { runResearchDecision, runResearchAgent } from './contentEngine/researchAgent';

export { runTrendSignal, renderTrendSignalBlock } from './contentEngine/trendAgent';

export { runHookAgent } from './contentEngine/hookAgent';

export { runPlatformAdaptationAgent, getPlatformProfile, DEFAULT_PLATFORM_PROFILES } from './contentEngine/platformAgent';

export { collectContentContext } from './contentEngine/contentContext';

export { runCreatorAgent } from './contentEngine/creatorAgent';

export { runRewriteAgent } from './contentEngine/rewriteAgent';

export {
  MAX_QC_ATTEMPTS,
  reviewGeneratedContent,
  runQualityControlLoop,
} from './qualityEngine/qualityControl';

export { computeScheduleTimes, verifyPost } from './contentEngine/scheduling';

export { generateDraftImage, findMatchingMedia } from './contentEngine/media';

export { buildWorkspaceContext } from './contextEngine/workspaceContext';

export { evaluateAIDecision, recordAIDecision } from './decisionEngine/aiDecisionLayer';
