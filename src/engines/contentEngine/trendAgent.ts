import { trendSearch } from '@/services/trendSearch';
import type { CampaignPlan } from '@/types/assistant';
import type { WorkspaceContext } from '@/types/context';

// ============================================================================
// Trend Signal — optional add-on alongside the Research Agent
// (researchAgent.ts).
//
// Deliberately kept separate from Research: researchAgent.ts's whole
// contract is "never grounded in anything but the workspace's own Content
// Sources, never invented" (see its file header) — that guarantee has to
// stay literally true. Trend Signal is a different, explicitly-labeled
// kind of input: open-web search snippets about what's currently being
// discussed for this topic/industry, handed to the Creator as a
// "consider, don't cite" signal, the same "optional, additive context"
// role Strategy/Hook/Optimization Context already play there — never
// something the post can present as a verified fact or number.
//
// Entirely optional end-to-end: no trend_search_api_key configured (see
// credentials.ts) -> trend_available: false -> renderTrendSignalBlock
// returns null -> zero effect on the prompt, same degrade-gracefully
// contract as every other optional pipeline input.
// ============================================================================

export type TrendSignalResult = {
  trend_available: boolean;
  items: Array<{ title: string; snippet: string; url: string }>;
  reason: string;
};

const EMPTY_RESULT: TrendSignalResult = { trend_available: false, items: [], reason: 'not_attempted' };

/** Builds a short, topical search query from what this run already knows —
 * no extra AI call needed, same "deterministic assembly" style as
 * optimizationContext.ts. Industry grounds the query in the workspace's
 * actual field instead of a generic phrase that would return generic
 * results. */
function buildTrendQuery(plan: CampaignPlan, workspaceContext: WorkspaceContext | null): string {
  const industry = workspaceContext?.brand?.industry?.trim();
  const parts = [plan.objective?.trim(), industry].filter(Boolean);
  return parts.length ? `${parts.join(' - ')} اتجاهات حديثة` : '';
}

/** Runs the Trend Signal search. Never throws — any failure (no key
 * configured, provider error, network) degrades to trend_available: false,
 * same non-blocking contract as Research/Hook/Strategy. */
export async function runTrendSignal(
  workspaceId: string,
  plan: CampaignPlan,
  workspaceContext: WorkspaceContext | null,
): Promise<TrendSignalResult> {
  const query = buildTrendQuery(plan, workspaceContext);
  if (!query) return { ...EMPTY_RESULT, reason: 'no_query_material' };

  try {
    const result = await trendSearch.search(workspaceId, query);
    return {
      trend_available: result.trend_available,
      items: result.items.map((i) => ({ title: i.title, snippet: i.snippet, url: i.url })),
      reason: result.reason,
    };
  } catch (e) {
    return { ...EMPTY_RESULT, reason: e instanceof Error ? e.message : 'trend_search_failed' };
  }
}

/** Renders the result as a single, explicitly-hedged prompt block. The
 * wording here is load-bearing, not decoration: it's what stops this
 * optional web-search signal from being mistaken for the same grade of
 * grounding as Research's verified-evidence block right above it in
 * creatorAgent.ts. Returns null when there's nothing to say (no key
 * configured, no results) — same pattern as every other optional block. */
export function renderTrendSignalBlock(result: TrendSignalResult): string | null {
  if (!result.trend_available || result.items.length === 0) return null;

  const lines = result.items.map((i) => `- ${i.title}: ${i.snippet}`).join('\n');
  return `Current web context (unverified — from a general web search, not the workspace's own sources). Use this only to gauge what's currently relevant or being discussed; do NOT present anything from it as a confirmed fact, statistic, or quote, and do NOT cite it as a source in the post:\n${lines}`;
}
