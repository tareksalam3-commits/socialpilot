import { contentLearningsRepository } from '@/repositories/contentLearningsRepository';
import { contentRecommendationsRepository } from '@/repositories/contentRecommendationsRepository';
import { contentFatigueRepository } from '@/repositories/contentFatigueRepository';

// Phase 3, STEP 9 — Optimization Context (section 20). Deterministic
// filtering/assembly only (section 25) — no AI call of its own. Scopes
// down to the platform(s)/objective this specific run is for, per section
// 20's "لا ترسل جميع Learnings إلى كل Request". Section 21 ("Learning ≠
// Rule") is enforced at render time below: everything is phrased as a
// consideration for the model to weigh, never an instruction it must obey.

export type OptimizationContext = {
  relevant_learnings: string[];
  active_recommendations: string[];
  patterns_to_consider: string[];
  patterns_to_avoid: string[];
  performance_context: Record<string, unknown>;
};

const EMPTY_CONTEXT: OptimizationContext = {
  relevant_learnings: [],
  active_recommendations: [],
  patterns_to_consider: [],
  patterns_to_avoid: [],
  performance_context: {},
};

function learningMatchesScope(scope: Record<string, unknown>, platforms: string[]): boolean {
  const scopedPlatform = typeof scope.platform === 'string' ? scope.platform : null;
  return !scopedPlatform || platforms.includes(scopedPlatform);
}

/** Best-effort: any failure (network, RLS edge case) degrades to an empty
 * context, same non-blocking contract as every other optional pipeline
 * input (Strategy/Research/Hook) — a run never fails because Optimization
 * Context couldn't be built. */
export async function buildOptimizationContext(workspaceId: string, platforms: string[]): Promise<OptimizationContext> {
  try {
    const [learnings, recommendations, fatigueSignals] = await Promise.all([
      contentLearningsRepository.listActive(workspaceId),
      contentRecommendationsRepository.listActionable(workspaceId),
      contentFatigueRepository.listWarnings(workspaceId),
    ]);

    const scopedLearnings = learnings.filter((l) => learningMatchesScope(l.scope, platforms));
    const scopedRecommendations = recommendations.filter((r) => learningMatchesScope(r.scope, platforms));
    const scopedFatigue = fatigueSignals.filter((f) => platforms.includes(f.platform));

    return {
      relevant_learnings: scopedLearnings.slice(0, 5).map((l) => l.learning),
      active_recommendations: scopedRecommendations.slice(0, 5).map((r) => r.recommendation),
      // Positive-lift learnings the Creator may lean toward.
      patterns_to_consider: scopedLearnings
        .filter((l) => (l.evidence as { lift?: number })?.lift !== undefined && ((l.evidence as { lift: number }).lift ?? 0) >= 0)
        .slice(0, 5)
        .map((l) => l.learning),
      // Fatigue warnings — repeated AND declining, per section 23.
      patterns_to_avoid: scopedFatigue.map(
        (f) => `تكرار مرتفع في ${f.dimension === 'content_pillar' ? 'محور المحتوى' : f.dimension === 'hook_type' ? 'نوع الافتتاحية' : 'الصيغة'} "${f.value}" مع أداء متراجع — غيّر الزاوية أو الصيغة.`,
      ),
      performance_context: {
        active_learning_count: scopedLearnings.length,
        actionable_recommendation_count: scopedRecommendations.length,
        fatigue_warning_count: scopedFatigue.length,
      },
    };
  } catch {
    return EMPTY_CONTEXT;
  }
}

/** Renders the context as a single prompt block for the Creator Agent —
 * explicitly framed as considerations, never commands (section 21). Empty
 * context renders to null so nothing gets injected when there's nothing
 * to say yet (new/low-data workspaces), same pattern as every other
 * optional block in buildIntelligenceContextBlock. */
export function renderOptimizationContextBlock(context: OptimizationContext): string | null {
  const sections: string[] = [];

  if (context.patterns_to_consider.length) {
    sections.push(`Things that have tended to work well recently (consider, but don't force into every post):\n${context.patterns_to_consider.map((p) => `- ${p}`).join('\n')}`);
  }
  if (context.patterns_to_avoid.length) {
    sections.push(`Content fatigue warning — vary the angle/format away from these if this post would otherwise repeat them:\n${context.patterns_to_avoid.map((p) => `- ${p}`).join('\n')}`);
  }

  if (!sections.length) return null;

  return `Optimization Context — derived from this workspace's actual published-post performance. These are considerations to weigh, not rules: keep the freedom to pick the best angle for this specific post; the goal is variety and quality, not repeating the same winning formula every time.\n\n${sections.join('\n\n')}`;
}
