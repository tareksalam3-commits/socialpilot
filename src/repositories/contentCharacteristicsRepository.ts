import { supabase } from '@/services/supabase';
import type { ContentCharacteristics } from '@/types/context';

// Content <-> Performance (Phase 3, STEP 5). Written once per post,
// best-effort — same non-blocking contract as recordAIDecision: a failure
// to save characteristics never blocks post creation/scheduling, it just
// means that post is invisible to Pattern Detection later (which is
// correct per section 10's Minimum Evidence rule — no data, no inference).
export const contentCharacteristicsRepository = {
  async create(input: ContentCharacteristics): Promise<void> {
    const { error } = await supabase.from('content_characteristics').insert({
      post_id: input.post_id,
      workspace_id: input.workspace_id,
      topic: input.topic,
      content_pillar: input.content_pillar,
      hook_type: input.hook_type,
      hook_text: input.hook_text,
      format: input.format,
      length_bucket: input.length_bucket,
      char_count: input.char_count,
      cta_type: input.cta_type,
      tone: input.tone,
      objective: input.objective,
      audience_persona: input.audience_persona,
      platforms: input.platforms,
      publishing_time: input.publishing_time,
      source: input.source,
    });
    if (error) throw error;
  },

  async listByWorkspace(workspaceId: string): Promise<ContentCharacteristics[]> {
    const { data, error } = await supabase
      .from('content_characteristics')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    return (data ?? []) as ContentCharacteristics[];
  },

  /** The workspace's own most-recently-used content pillars, most recent
   * first, de-duplicated. Feeds the Strategy Agent so it reuses an
   * existing pillar name instead of re-coining new phrasing for the same
   * idea every run — pattern detection (detect_content_patterns) GROUPs BY
   * this column's exact text, so consistent naming is what lets that
   * dimension ever accumulate a usable sample size. Best-effort: caller
   * treats a failure the same as "no history yet" (empty list). */
  async listRecentPillars(workspaceId: string, limit = 8): Promise<string[]> {
    const { data, error } = await supabase
      .from('content_characteristics')
      .select('content_pillar, created_at')
      .eq('workspace_id', workspaceId)
      .not('content_pillar', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    const seen = new Set<string>();
    const pillars: string[] = [];
    for (const row of data ?? []) {
      const pillar = (row as { content_pillar: string | null }).content_pillar;
      if (!pillar || seen.has(pillar)) continue;
      seen.add(pillar);
      pillars.push(pillar);
      if (pillars.length >= limit) break;
    }
    return pillars;
  },
};
