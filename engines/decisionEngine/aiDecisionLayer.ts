import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import type { ContentQualityResult } from '@/types/assistant';
import type { ResearchResult, AIDecision, AIDecisionTask } from '@/types/context';
import { WORKSPACE_CONTEXT_VERSION } from '@/types/context';

// ============================================================================
// AI Decision Layer — Phase 2, STEP 13 (section 24)
//
// A single, central place that turns "should this important operation
// actually go ahead?" into one of EXECUTE/RESEARCH/REWRITE/IMPROVE/
// HUMAN_REVIEW/ABORT, always computed deterministically in code from
// `quality.decision` (the Quality Decision Layer's own verdict, STEP
// 11/section 21) plus this operation's own risk context — never by asking
// a model to grade its own risk. This does NOT duplicate STEP 11's logic:
// it reuses `quality.decision` as-is and only adds the operation-level
// layer section 24 asks for on top (task + whether Research actually
// landed).
//
// Scope for this step, same "capability now, full consumption later"
// pattern as Platform Adaptation (STEP 10) and Hook Intelligence (STEP 9)
// before their own consuming steps landed: evaluateAIDecision() is real and
// wired into both points in the current pipeline where an AI-authored
// draft is about to move forward (the Content/Quality Engine's
// generate-then-review loop, and the Approve/Schedule step), and every
// decision is logged via recordAIDecision() per section 28's "AI decision
// قابل للتسجيل" (never a full Learning Engine — section 28/34 explicitly
// rule that out for Phase 2). It does NOT yet gate whether scheduling
// actually proceeds when the verdict is ABORT/HUMAN_REVIEW/etc. —
// validateFinalPostContent (contentGuards.ts) remains the only hard gate
// before a post can be scheduled, exactly as before this step, so
// Regression testing (section 35: "Scheduling يعمل") stays untouched.
// Turning EXECUTE/ABORT into an actual pipeline-blocking gate is a
// deliberate, separate decision for a later step — this file's job here is
// only to make the verdict real, correct, and traceable.
// ============================================================================

/** Turns the Quality Decision Layer's per-content verdict (STEP 11) into
 * the operation-level AIDecision section 24 asks for. `research` is
 * optional context (only known at draft-generation time in the current
 * pipeline, not at schedule time) — when absent, the decision is based on
 * quality alone, same as if research were simply not required. */
export function evaluateAIDecision(
  task: AIDecisionTask,
  quality: ContentQualityResult | null,
  research?: ResearchResult | null,
): AIDecision {
  if (!quality) {
    return {
      task,
      decision: 'HUMAN_REVIEW',
      confidence: 0.3,
      risk: 'high',
      reason: 'تعذّر تشغيل Quality Control لهذا المحتوى — لا تتوفر بيانات كافية لاتخاذ قرار تلقائي موثوق.',
    };
  }

  const qDecision = quality.decision;
  if (!qDecision) {
    // Quality parsed but the Quality Decision Layer's verdict wasn't
    // attached (shouldn't normally happen post-STEP 11, but never assume) —
    // same conservative fallback as QC being unavailable entirely.
    return {
      task,
      decision: 'HUMAN_REVIEW',
      confidence: 0.3,
      risk: 'medium',
      reason: 'لا يتوفر قرار Quality Decision Layer لهذا المحتوى.',
    };
  }

  switch (qDecision.decision) {
    case 'REJECT':
      // A Quality Decision Layer REJECT means a Critical Issue was found
      // (section 20) — the closest, and most severe, of this layer's own
      // six labels is ABORT: this operation must not proceed at all.
      return { task, decision: 'ABORT', confidence: qDecision.confidence, risk: 'high', reason: qDecision.reason };

    case 'REWRITE':
      return { task, decision: 'REWRITE', confidence: qDecision.confidence, risk: 'medium', reason: qDecision.reason };

    case 'RESEARCH':
      return { task, decision: 'RESEARCH', confidence: qDecision.confidence, risk: 'high', reason: qDecision.reason };

    case 'IMPROVE':
      return { task, decision: 'IMPROVE', confidence: qDecision.confidence, risk: 'medium', reason: qDecision.reason };

    case 'HUMAN_REVIEW':
      return { task, decision: 'HUMAN_REVIEW', confidence: qDecision.confidence, risk: 'medium', reason: qDecision.reason };

    case 'APPROVE': {
      // Content cleared Quality Control — but section 24's own "context"
      // input means an operation-level risk can still override a clean
      // quality verdict. The one such risk this pipeline can actually see
      // today: the Research Decision (STEP 7) said this content NEEDED
      // grounding, and Research never actually came back available. A
      // content-quality pass alone can't catch a plausible-sounding but
      // unverified factual claim, so this operation still waits on
      // Research rather than executing.
      if (research?.research_required && !research.research_available) {
        return {
          task,
          decision: 'RESEARCH',
          confidence: Math.min(qDecision.confidence, 0.6),
          risk: 'high',
          reason: 'المحتوى مصنّف بأنه يحتاج تحققًا من مصادر خارجية (Research Decision) لكن لم يتوفر Research فعلي بعد.',
        };
      }
      return { task, decision: 'EXECUTE', confidence: qDecision.confidence, risk: 'low', reason: qDecision.reason };
    }

    default:
      return { task, decision: 'HUMAN_REVIEW', confidence: 0.3, risk: 'medium', reason: 'قرار غير معروف من Quality Decision Layer.' };
  }
}

/** Section 28 — "أي AI decision مهم يجب أن يكون قابلًا للتسجيل: request_id,
 * task, agent, context_version, model, provider, decision, result,
 * quality_score. بدون بناء نظام Learning كامل الآن." Reuses the existing
 * `ai_history` table/repository (no new table — same "أعد استخدام الموجود"
 * rule as everywhere else in Phase 2) rather than building anything new;
 * `metadata` carries the structured fields a future Learning Engine (Phase
 * 3, explicitly out of scope here) would need without building it now.
 * Never throws — logging is best-effort and must never block the caller's
 * actual pipeline step. */
export async function recordAIDecision(
  workspaceId: string,
  decision: AIDecision,
  opts: { agent?: string; contextVersion?: number; qualityScore?: number | null } = {},
): Promise<void> {
  try {
    await aiHistoryRepository.create({
      workspace_id: workspaceId,
      type: 'ai_decision',
      input: JSON.stringify({ task: decision.task, agent: opts.agent ?? 'ai_decision_layer' }),
      output: decision.decision,
      model: null,
      status: 'success',
      metadata: {
        decision: decision.decision,
        confidence: decision.confidence,
        reason: decision.reason,
        risk: decision.risk,
        task: decision.task,
        context_version: opts.contextVersion ?? WORKSPACE_CONTEXT_VERSION,
        quality_score: opts.qualityScore ?? null,
      },
    });
  } catch {
    // best-effort — an AI decision that failed to log must never block
    // the operation it was evaluated for.
  }
}
