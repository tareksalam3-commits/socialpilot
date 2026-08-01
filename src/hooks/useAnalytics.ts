import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { supabase } from '@/services/supabase';
import type { PostAnalytics, AccountAnalytics } from '@/types/social';

export type AnalyticsSummary = {
  totalPosts: number;
  publishedPosts: number;
  scheduledPosts: number;
  failedPosts: number;
  connectedAccounts: number;
  totalReach: number;
  totalImpressions: number;
  totalEngagement: number;
  totalClicks: number;
  totalFollowers: number;
  followersGrowth: number;
  topPosts: { post_id: string; title: string | null; content: string; reach: number; engagement: number }[];
  dailyData: { date: string; posts: number; reach: number; engagement: number }[];
};

export function useAnalytics(days = 30) {
  const { workspace } = useWorkspace();
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

      const [postsRes, accountsRes, postAnalyticsRes, accountAnalyticsRes] = await Promise.all([
        supabase.from('posts').select('id,title,content,status').eq('workspace_id', workspace.id),
        supabase.from('connected_accounts').select('id,platform,status').eq('workspace_id', workspace.id),
        supabase.from('post_analytics').select('post_id,reach,engagement,impressions,clicks').eq('workspace_id', workspace.id).gte('recorded_at', since.toISOString()),
        supabase.from('account_analytics').select('followers,followers_delta,reach,impressions,engagement,clicks,recorded_at').eq('workspace_id', workspace.id).gte('recorded_at', since.toISOString().slice(0, 10)),
      ]);

      const posts = postsRes.data ?? [];
      const accounts = accountsRes.data ?? [];
      const postAnalytics = (postAnalyticsRes.data ?? []) as PostAnalytics[];
      const accountAnalytics = (accountAnalyticsRes.data ?? []) as AccountAnalytics[];

      const published = posts.filter((p) => p.status === 'published');
      const scheduled = posts.filter((p) => p.status === 'scheduled');
      const failed = posts.filter((p) => p.status === 'failed');
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

      const dailyMap = new Map<string, { posts: number; reach: number; engagement: number }>();
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dailyMap.set(d.toISOString().slice(0, 10), { posts: 0, reach: 0, engagement: 0 });
      }
      for (const p of posts) {
        const d = (p as { created_at?: string }).created_at?.slice(0, 10);
        if (d && dailyMap.has(d)) {
          dailyMap.get(d)!.posts += 1;
        }
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

      setSummary({
        totalPosts: posts.length,
        publishedPosts: published.length,
        scheduledPosts: scheduled.length,
        failedPosts: failed.length,
        connectedAccounts: connected.length,
        totalReach,
        totalImpressions,
        totalEngagement,
        totalClicks,
        totalFollowers,
        followersGrowth,
        topPosts,
        dailyData,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }, [workspace, days]);

  useEffect(() => {
    load();
  }, [load]);

  return { summary, loading, error, reload: load };
}
