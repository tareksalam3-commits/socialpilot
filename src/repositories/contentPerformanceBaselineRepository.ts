import { supabase } from '@/services/supabase';

// Phase 3, STEP 4 — Performance Baseline. Read-only from the client:
// baselines are computed server-side by compute_content_performance_baseline
// (triggered off post_analytics writes), never written directly by the app.
export type ContentPerformanceBaseline = {
  workspace_id: string;
  platform: string;
  objective: string | null;
  sample_size: number;
  min_sample_size_met: boolean;
  avg_reach: number | null;
  avg_impressions: number | null;
  avg_engagement: number | null;
  avg_engagement_rate: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  avg_shares: number | null;
  avg_saves: number | null;
  avg_clicks: number | null;
  avg_ctr: number | null;
  avg_views: number | null;
  avg_watch_time_seconds: number | null;
  avg_completion_rate: number | null;
  avg_profile_visits: number | null;
  computed_at: string;
};

export const contentPerformanceBaselineRepository = {
  async listByWorkspace(workspaceId: string): Promise<ContentPerformanceBaseline[]> {
    const { data, error } = await supabase
      .from('content_performance_baselines')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    return (data ?? []) as ContentPerformanceBaseline[];
  },

  /** The plain (all-objectives) baseline for a single platform — objective IS NULL. */
  async getForPlatform(workspaceId: string, platform: string): Promise<ContentPerformanceBaseline | null> {
    const { data, error } = await supabase
      .from('content_performance_baselines')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .is('objective', null)
      .maybeSingle();
    if (error) throw error;
    return data as ContentPerformanceBaseline | null;
  },

  async getForPlatformAndObjective(workspaceId: string, platform: string, objective: string): Promise<ContentPerformanceBaseline | null> {
    const { data, error } = await supabase
      .from('content_performance_baselines')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .eq('objective', objective)
      .maybeSingle();
    if (error) throw error;
    return data as ContentPerformanceBaseline | null;
  },
};
