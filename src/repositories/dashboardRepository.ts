import { supabase } from '@/services/supabase';
import type { Activity, AiUsage, ConnectedAccount, ScheduledPost } from '@/types/database';

export const dashboardRepository = {
  async getConnectedAccounts(workspaceId: string): Promise<ConnectedAccount[]> {
    const { data, error } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ConnectedAccount[];
  },

  async getScheduledPosts(workspaceId: string): Promise<ScheduledPost[]> {
    const { data, error } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ScheduledPost[];
  },

  async getAiUsage(workspaceId: string): Promise<AiUsage | null> {
    const { data, error } = await supabase
      .from('ai_usage')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data as AiUsage | null;
  },

  async getRecentActivity(workspaceId: string, limit = 8): Promise<Activity[]> {
    const { data, error } = await supabase
      .from('activity')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as Activity[];
  },
};
