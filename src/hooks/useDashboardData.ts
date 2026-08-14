import { useEffect, useState } from 'react';
import { dashboardRepository } from '@/repositories/dashboardRepository';
import type { Activity, AiUsage, ConnectedAccount, ScheduledPost } from '@/types/database';

type DashboardData = {
  connectedAccounts: ConnectedAccount[];
  scheduledPosts: ScheduledPost[];
  aiUsage: AiUsage | null;
  recentActivity: Activity[];
  loading: boolean;
  error: string | null;
};

export function useDashboardData(workspaceId: string | null): DashboardData {
  const [data, setData] = useState<Omit<DashboardData, 'loading' | 'error'>>({
    connectedAccounts: [],
    scheduledPosts: [],
    aiUsage: null,
    recentActivity: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const [connectedAccounts, scheduledPosts, aiUsage, recentActivity] = await Promise.all([
          dashboardRepository.getConnectedAccounts(workspaceId),
          dashboardRepository.getScheduledPosts(workspaceId),
          dashboardRepository.getAiUsage(workspaceId),
          dashboardRepository.getRecentActivity(workspaceId),
        ]);
        if (active) setData({ connectedAccounts, scheduledPosts, aiUsage, recentActivity });
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [workspaceId]);

  return { ...data, loading, error };
}
