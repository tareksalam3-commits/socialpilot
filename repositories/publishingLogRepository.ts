import { supabase } from '@/services/supabase';
import type { PublishingLog } from '@/types/social';

export const publishingLogRepository = {
  async list(workspaceId: string, limit = 30): Promise<PublishingLog[]> {
    const { data, error } = await supabase
      .from('publishing_logs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as PublishingLog[];
  },
};
