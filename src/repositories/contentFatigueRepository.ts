import { supabase } from '@/services/supabase';

export type ContentFatigueSignal = {
  id: string;
  workspace_id: string;
  platform: string;
  dimension: 'content_pillar' | 'hook_type' | 'format';
  value: string | null;
  window_sample_size: number;
  repeat_ratio: number | null;
  performance_trend: 'improving' | 'flat' | 'declining' | null;
  status: 'warning' | 'ok';
  detected_at: string;
};

// Phase 3, STEP 10 — Content Fatigue Detection. Read-only from the
// client: rows are written server-side by detect_content_fatigue.
export const contentFatigueRepository = {
  async listByWorkspace(workspaceId: string): Promise<ContentFatigueSignal[]> {
    const { data, error } = await supabase
      .from('content_fatigue_signals')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    return (data ?? []) as ContentFatigueSignal[];
  },

  async listWarnings(workspaceId: string): Promise<ContentFatigueSignal[]> {
    const { data, error } = await supabase
      .from('content_fatigue_signals')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'warning');
    if (error) throw error;
    return (data ?? []) as ContentFatigueSignal[];
  },
};
