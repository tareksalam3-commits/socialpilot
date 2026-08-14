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
};
