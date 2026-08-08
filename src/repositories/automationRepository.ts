import { supabase } from '@/services/supabase';
import type { Post, PostPlatformTarget, PublishingLog, SchedulerStatus } from '@/types/social';

export type FailedQueueRow = PostPlatformTarget & {
  post_title: string | null;
  post_content: string;
};

export const automationRepository = {
  /** Posts currently queued or actively being sent — the Publishing Queue. */
  async getPublishingQueue(workspaceId: string): Promise<Post[]> {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('status', ['scheduled', 'publishing'])
      .order('scheduled_for', { ascending: true, nullsFirst: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as Post[];
  },

  /** Upcoming scheduled jobs — same underlying data as the queue, but only
   * the ones still waiting on their scheduled time (not yet publishing). */
  async getScheduledJobs(workspaceId: string): Promise<Post[]> {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'scheduled')
      .order('scheduled_for', { ascending: true })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as Post[];
  },

  /** Failed platform targets across the workspace — the Failed Queue. */
  async getFailedQueue(workspaceId: string): Promise<FailedQueueRow[]> {
    const { data, error } = await supabase
      .from('post_platform_targets')
      .select('*, posts!inner(title, content, workspace_id)')
      .eq('status', 'failed')
      .eq('posts.workspace_id', workspaceId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []).map((row: Record<string, unknown>) => {
      const { posts, ...target } = row as Record<string, unknown> & { posts: { title: string | null; content: string } };
      return { ...(target as PostPlatformTarget), post_title: posts.title, post_content: posts.content };
    });
  },

  /** Recent publishing activity — Execution Logs. */
  async getExecutionLogs(workspaceId: string, limit = 100): Promise<PublishingLog[]> {
    const { data, error } = await supabase
      .from('publishing_logs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as PublishingLog[];
  },

  /** Background Jobs / Job Status — the pg_cron scheduler's own run history.
   * This is a global (not per-workspace) system status, since the cron job
   * itself isn't workspace-scoped. */
  async getSchedulerStatus(): Promise<SchedulerStatus | null> {
    const { data, error } = await supabase.rpc('get_scheduler_status');
    if (error) throw error;
    const rows = (data ?? []) as SchedulerStatus[];
    return rows[0] ?? null;
  },

  async setAutoPublishEnabled(workspaceId: string, enabled: boolean): Promise<void> {
    const { error } = await supabase
      .from('workspaces')
      .update({ auto_publish_enabled: enabled, updated_at: new Date().toISOString() })
      .eq('id', workspaceId);
    if (error) throw error;
  },
};
