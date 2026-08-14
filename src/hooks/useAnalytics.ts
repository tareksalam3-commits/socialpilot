import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { supabase } from '@/services/supabase';
import { aiAnalyticsRepository } from '@/repositories/aiHistoryRepository';
import { activityRepository } from '@/repositories/workspaceMemberRepository';
import type { PostAnalytics, AccountAnalytics } from '@/types/social';
import type { AiUsage } from '@/types/database';

export type AnalyticsSummary = {
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  failedPosts: number;
  draftPosts: number;
  connectedAccounts: number;
  totalReach: number;
  totalImpressions: number;
  totalEngagement: number;
  totalClicks: number;
  totalFollowers: number;
  followersGrowth: number;
  topPosts: { post_id: string; title: string | null; content: string; reach: number; engagement: number }[];
  dailyData: { date: string; posts: number; reach: number; engagement: number }[];
  postsStatusBreakdown: { status: 'published' | 'scheduled' | 'failed' | 'draft'; count: number }[];
  aiUsage: {
    creditsUsed: number;
    creditsLimit: number;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    dailyRequests: { date: string; count: number }[];
  };
  workspaceActivity: {
    total: number;
    byType: { type: string; count: number }[];
    dailyCount: { date: string; count: number }[];
    recent: { id: string; type: string; description: string; created_at: string }[];
  };
};

function buildDailyBuckets(days: number): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  return map;
}

export function useAnalytics(days = 30) {
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setLoading(true);
      setError(null);

      const since = new Date();
      since.setDate(since.getDate() - days);

      const [postsRes, accountsRes, postAnalyticsRes, accountAnalyticsRes, aiUsageRes, aiEvents, activityList] = await Promise.all([
        supabase.from('posts').select('id,title,content,status,created_at').eq('workspace_id', workspace.id),
        supabase.from('connected_accounts').select('id,platform,status').eq('workspace_id', workspace.id),
        supabase.from('post_analytics').select('post_id,reach,engagement,impressions,clicks').eq('workspace_id', workspace.id).gte('recorded_at', since.toISOString()),
        supabase.from('account_analytics').select('followers,followers_delta,reach,impressions,engagement,clicks,recorded_at').eq('workspace_id', workspace.id).gte('recorded_at', since.toISOString().slice(0, 10)),
        supabase.from('ai_usage').select('credits_used,credits_limit').eq('workspace_id', workspace.id).maybeSingle(),
        user ? aiAnalyticsRepository.getEvents(user.id, days) : Promise.resolve([]),
        activityRepository.list(workspace.id, 200),
      ]);

      const posts = postsRes.data ?? [];
      const accounts = accountsRes.data ?? [];
      const postAnalytics = (postAnalyticsRes.data ?? []) as PostAnalytics[];
      const accountAnalytics = (accountAnalyticsRes.data ?? []) as AccountAnalytics[];
      const aiUsageRow = aiUsageRes.data as Pick<AiUsage, 'credits_used' | 'credits_limit'> | null;

      const published = posts.filter((p) => p.status === 'published');
      const scheduled = posts.filter((p) => p.status === 'scheduled');
      const failed = posts.filter((p) => p.status === 'failed');
      const drafts = posts.filter((p) => p.status === 'draft');
      const connected = accounts.filter((a) => a.status === 'connected');

      const totalReach = accountAnalytics.reduce((s, a) => s + a.reach, 0);
      const totalImpressions = accountAnalytics.reduce((s, a) => s + a.impressions, 0);
      const totalEngagement = accountAnalytics.reduce((s, a) => s + a.engagement, 0);
      const totalClicks = accountAnalytics.reduce((s, a) => s + a.clicks, 0);
      const totalFollowers = accountAnalytics.length > 0 ? accountAnalytics[accountAnalytics.length - 1].followers : 0;
      const followersGrowth = accountAnalytics.reduce((s, a) => s + a.followers_delta, 0);

      const postReachMap = new Map<string, number>();
      const postEngagementMap = new Map<string, number>();
      for (const pa of postAnalytics) {
        postReachMap.set(pa.post_id, (postReachMap.get(pa.post_id) ?? 0) + pa.reach);
        postEngagementMap.set(pa.post_id, (postEngagementMap.get(pa.post_id) ?? 0) + pa.engagement);
      }

      const topPosts = published
        .map((p) => ({
          post_id: p.id,
          title: p.title,
          content: p.content,
          reach: postReachMap.get(p.id) ?? 0,
          engagement: postEngagementMap.get(p.id) ?? 0,
        }))
        .sort((a, b) => b.engagement - a.engagement)
        .slice(0, 5);

      const dailyBuckets = buildDailyBuckets(days);
      const dailyMap = new Map<string, { posts: number; reach: number; engagement: number }>();
      for (const date of dailyBuckets.keys()) dailyMap.set(date, { posts: 0, reach: 0, engagement: 0 });
      for (const p of posts) {
        const d = (p as { created_at?: string }).created_at?.slice(0, 10);
        if (d && dailyMap.has(d)) dailyMap.get(d)!.posts += 1;
      }
      for (const a of accountAnalytics) {
        const d = a.recorded_at.slice(0, 10);
        if (dailyMap.has(d)) {
          dailyMap.get(d)!.reach += a.reach;
          dailyMap.get(d)!.engagement += a.engagement;
        }
      }
      const dailyData = Array.from(dailyMap.entries())
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // AI usage
      const aiDailyBuckets = buildDailyBuckets(days);
      for (const ev of aiEvents) {
        const d = ev.created_at.slice(0, 10);
        if (aiDailyBuckets.has(d)) aiDailyBuckets.set(d, aiDailyBuckets.get(d)! + 1);
      }
      const aiDailyRequests = Array.from(aiDailyBuckets.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // Workspace activity
      const activityInRange = activityList.filter((a) => new Date(a.created_at) >= since);
      const activityTypeMap = new Map<string, number>();
      for (const a of activityInRange) {
        activityTypeMap.set(a.type, (activityTypeMap.get(a.type) ?? 0) + 1);
      }
      const activityDailyBuckets = buildDailyBuckets(days);
      for (const a of activityInRange) {
        const d = a.created_at.slice(0, 10);
        if (activityDailyBuckets.has(d)) activityDailyBuckets.set(d, activityDailyBuckets.get(d)! + 1);
      }
      const activityDailyCount = Array.from(activityDailyBuckets.entries())
        .map(([date, count]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      setSummary({
        totalPosts: posts.length,
        publishedPosts: published.length,
        scheduledPosts: scheduled.length,
        failedPosts: failed.length,
        draftPosts: drafts.length,
        connectedAccounts: connected.length,
        totalReach,
        totalImpressions,
        totalEngagement,
        totalClicks,
        totalFollowers,
        followersGrowth,
        topPosts,
        dailyData,
        postsStatusBreakdown: [
          { status: 'published', count: published.length },
          { status: 'scheduled', count: scheduled.length },
          { status: 'failed', count: failed.length },
          { status: 'draft', count: drafts.length },
        ],
        aiUsage: {
          creditsUsed: aiUsageRow?.credits_used ?? 0,
          creditsLimit: aiUsageRow?.credits_limit ?? 0,
          totalRequests: aiEvents.length,
          successfulRequests: aiEvents.filter((e) => e.status === 'success').length,
          failedRequests: aiEvents.filter((e) => e.status !== 'success').length,
          dailyRequests: aiDailyRequests,
        },
        workspaceActivity: {
          total: activityInRange.length,
          byType: Array.from(activityTypeMap.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count),
          dailyCount: activityDailyCount,
          recent: activityList.slice(0, 8).map((a) => ({ id: a.id, type: a.type, description: a.description, created_at: a.created_at })),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [workspace, user, days]);

  useEffect(() => {
    load();
  }, [load]);

  return { summary, loading, error, reload: load };
}
