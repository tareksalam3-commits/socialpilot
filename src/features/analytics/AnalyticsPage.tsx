import { useState } from 'react';
import { Activity, BarChart3, CalendarClock, Eye, Link2, MousePointerClick, TrendingUp, Users, Zap } from 'lucide-react';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Card, CardSkeleton, EmptyState, ErrorState } from '@/ui';
import { formatDate } from '@/utils/format';

export function AnalyticsPage() {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const { summary, loading, error } = useAnalytics(days);

  if (error) return <ErrorState description={error} />;
  if (loading) return <div className="space-y-6"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div></div>;
  if (!summary || summary.totalPosts === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('analytics.title')}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('analytics.subtitle')}</p></div></div>
        <Card><EmptyState icon={<BarChart3 className="h-10 w-10" />} title={t('analytics.empty.title')} description={t('analytics.empty.description')} /></Card>
      </div>
    );
  }

  const maxDailyPosts = Math.max(...summary.dailyData.map((d) => d.posts), 1);
  const maxDailyReach = Math.max(...summary.dailyData.map((d) => d.reach), 1);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('analytics.title')}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('analytics.subtitle')}</p></div>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <option value={7}>{t('analytics.range.7d')}</option><option value={30}>{t('analytics.range.30d')}</option><option value={90}>{t('analytics.range.90d')}</option>
        </select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<CalendarClock className="h-5 w-5" />} label={t('analytics.stat.totalPosts')} value={summary.totalPosts} hint={t('analytics.stat.published', { count: summary.publishedPosts })} tone="sky" />
        <StatCard icon={<Link2 className="h-5 w-5" />} label={t('analytics.stat.connectedAccounts')} value={summary.connectedAccounts} tone="emerald" />
        <StatCard icon={<Eye className="h-5 w-5" />} label={t('analytics.stat.totalReach')} value={summary.totalReach.toLocaleString()} tone="amber" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label={t('analytics.stat.engagement')} value={summary.totalEngagement.toLocaleString()} tone="slate" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Activity className="h-5 w-5" />} label={t('analytics.stat.impressions')} value={summary.totalImpressions.toLocaleString()} tone="sky" />
        <StatCard icon={<MousePointerClick className="h-5 w-5" />} label={t('analytics.stat.clicks')} value={summary.totalClicks.toLocaleString()} tone="emerald" />
        <StatCard icon={<Users className="h-5 w-5" />} label={t('analytics.stat.followers')} value={summary.totalFollowers.toLocaleString()} hint={t('analytics.stat.growth', { sign: summary.followersGrowth >= 0 ? '+' : '', growth: summary.followersGrowth })} tone="amber" />
        <StatCard icon={<Zap className="h-5 w-5" />} label={t('analytics.stat.failedPosts')} value={summary.failedPosts} tone="slate" />
      </div>

      {/* Daily chart */}
      <Card title={t('analytics.dailyActivity.title')} description={t('analytics.dailyActivity.description', { days })}>
        <div className="space-y-2">
          {summary.dailyData.slice(-14).map((d) => (
            <div key={d.date} className="flex items-center gap-3">
              <span className="w-20 text-xs text-slate-500 dark:text-slate-400">{formatDate(d.date)}</span>
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <div className="h-4 rounded bg-sky-200 dark:bg-sky-900" style={{ width: `${(d.posts / maxDailyPosts) * 100}%` }} />
                  <span className="text-xs text-slate-500">{d.posts}</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1">
                  <div className="h-4 rounded bg-emerald-200 dark:bg-emerald-900" style={{ width: `${(d.reach / maxDailyReach) * 100}%` }} />
                  <span className="text-xs text-slate-500">{d.reach.toLocaleString()}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Top performing posts */}
      <Card title={t('analytics.topPosts.title')} description={t('analytics.topPosts.description')}>
        {summary.topPosts.length === 0 ? <p className="py-4 text-center text-sm text-slate-500">{t('analytics.topPosts.empty')}</p> : (
          <div className="space-y-3">
            {summary.topPosts.map((p, i) => (
              <div key={p.post_id} className="flex items-start gap-3 rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{i + 1}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{p.title ?? p.content.slice(0, 60) + '…'}</p>
                  <div className="mt-1 flex gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>{t('analytics.topPosts.reach', { count: p.reach.toLocaleString() })}</span>
                    <span>{t('analytics.topPosts.engagement', { count: p.engagement.toLocaleString() })}</span>
                  </div>
                </div>
                <Badge variant="info">#{i + 1}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const toneMap = { sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300', emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' };

function StatCard({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string | number; hint?: string; tone: keyof typeof toneMap }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneMap[tone]}`}>{icon}</div>
      <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
