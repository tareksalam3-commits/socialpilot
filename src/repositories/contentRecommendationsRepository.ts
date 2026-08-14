import { supabase } from '@/services/supabase';

export type RecommendationType = 'TOPIC' | 'HOOK' | 'FORMAT' | 'CTA' | 'CONTENT_LENGTH' | 'PLATFORM' | 'CONTENT_MIX' | 'POSTING_TIME' | 'CONTENT_PILLAR';
export type RecommendationStatus = 'NEW' | 'VIEWED' | 'ACCEPTED' | 'DISMISSED' | 'APPLIED' | 'EXPIRED';

export type ContentRecommendation = {
  id: string;
  workspace_id: string;
  learning_id: string | null;
  type: RecommendationType;
  recommendation: string;
  reason: string | null;
  evidence: Record<string, unknown>;
  confidence: number | null;
  expected_impact: string | null;
  scope: Record<string, unknown>;
  status: RecommendationStatus;
  created_at: string;
  updated_at: string;
};

// Phase 3, STEP 8 — Recommendation Engine. Rows are generated server-side
// (generate_recommendations_from_learnings); the client only ever moves
// `status` forward (section 16/18 — Apply/Dismiss/Viewed).
export const contentRecommendationsRepository = {
  async listByWorkspace(workspaceId: string): Promise<ContentRecommendation[]> {
    const { data, error } = await supabase
      .from('content_recommendations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ContentRecommendation[];
  },

  async listActionable(workspaceId: string): Promise<ContentRecommendation[]> {
    const { data, error } = await supabase
      .from('content_recommendations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['NEW', 'VIEWED', 'ACCEPTED'])
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ContentRecommendation[];
  },

  async updateStatus(id: string, status: RecommendationStatus): Promise<void> {
    const { error } = await supabase.from('content_recommendations').update({ status }).eq('id', id);
    if (error) throw error;
  },
};
