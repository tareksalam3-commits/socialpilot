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
      .from('posts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'scheduled')
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
    if (!data) return null;

    // Plan name comes from a SECURITY DEFINER RPC (not a direct table
    // join) so that any workspace member can see it, not just the owner
    // who the `subscriptions` RLS policy is scoped to. Non-fatal if it
    // fails — the credits numbers above are still real either way.
    const { data: planInfo } = await supabase.rpc('get_workspace_plan_info', { p_workspace_id: workspaceId });
    const plan = Array.isArray(planInfo) ? planInfo[0] : planInfo;

    return {
      ...(data as AiUsage),
      plan_name: plan?.plan_name ?? null,
      plan_slug: plan?.plan_slug ?? null,
      current_period_end: plan?.current_period_end ?? null,
    };
  },

  async getRecentActivity(workspaceId: string, limit = 8): Promise<Activity[]> {
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as Activity[];
  },
};
