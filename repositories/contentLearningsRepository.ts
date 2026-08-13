import { supabase } from '@/services/supabase';

export type ContentLearning = {
  id: string;
  workspace_id: string;
  pattern_id: string | null;
  learning: string;
  evidence: Record<string, unknown>;
  scope: Record<string, unknown>;
  confidence: number | null;
  sample_size: number;
  status: 'ACTIVE' | 'WEAK' | 'STALE' | 'INVALIDATED';
  created_at: string;
  updated_at: string;
};

// Phase 3, STEP 7 — Learning Memory. Read-only from the client: rows are
// written server-side by generate_learnings_from_patterns.
export const contentLearningsRepository = {
  async listActive(workspaceId: string): Promise<ContentLearning[]> {
    const { data, error } = await supabase
      .from('content_learnings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'ACTIVE')
      .order('confidence', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ContentLearning[];
  },

  async listAll(workspaceId: string): Promise<ContentLearning[]> {
    const { data, error } = await supabase
      .from('content_learnings')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ContentLearning[];
  },
};
