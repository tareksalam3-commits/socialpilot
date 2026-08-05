import { useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  Eye,
  Link2,
  MousePointerClick,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import { useAnalytics } from '@/hooks/useAnalytics';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Card, CardSkeleton, EmptyState, ErrorState } from '@/ui';
import { BarChart, DonutChart, LineChart } from '@/components/charts';
import { formatDate, timeAgo } from '@/utils/format';

const STATUS_COLORS: Record<string, string> = {
  published: '#10b981',
  scheduled: '#0ea5e9',
  failed: '#f43f5e',
  draft: '#94a3b8',
};

export function AnalyticsPage() {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const { summary, loading, error, reload } = useAnalytics(days);

  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={`b-${i}`} />
          ))}
        </div>
      </div>
    );
  }
  if (!summary || summary.totalPosts === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('analytics.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('analytics.subtitle')}</p>
          </div>
        </div>
        <Card>
          <EmptyState icon={<BarChart3 className="h-10 w-10" />} title={t('analytics.empty.title')} description={t('analytics.empty.description')} />
        </Card>
      </div>
    );
  }

  const postsLineSeries = [
    { name: t('analytics.stat.totalPosts'), color: '#0ea5e9', points: summary.dailyData.map((d) => ({ label: formatDate(d.date).slice(0, 6), value: d.posts })) },
  ];
  const reachLineSeries = [
    { name: t('analytics.stat.totalReach'), color: '#10b981', points: summary.dailyData.map((d) => ({ label: formatDate(d.date).slice(0, 6), value: d.reach })) },
  ];

  const aiRequestsBarData = summary.aiUsage.dailyRequests.map((d) => ({ label: formatDate(d.date).slice(0, 6), value: d.count }));
  const activityBarData = summary.workspaceActivity.dailyCount.map((d) => ({ label: formatDate(d.date).slice(0, 6), value: d.count }));

  const statusDonutData = summary.postsStatusBreakdown
    .filter((s) => s.count > 0)
    .map((s) => ({ label: t(`analytics.status.${s.status}`), value: s.count, color: STATUS_COLORS[s.status] }));

  const activityTypeDonutData = summary.workspaceActivity.byType.slice(0, 6).map((a, i) => ({
    label: a.type,
    value: a.count,
    color: ['#0ea5e9', '#10b981', '#f59e0b', '#a855f7', '#f43f5e', '#64748b'][i % 6],
  }));

  const creditsPct = summary.aiUsage.creditsLimit > 0 ? Math.min(100, Math.round((summary.aiUsage.creditsUsed / summary.aiUsage.creditsLimit) * 100)) : 0;
  const aiSuccessRate = summary.aiUsage.totalRequests > 0 ? Math.round((summary.aiUsage.successfulRequests / summary.aiUsage.totalRequests) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('analytics.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('analytics.subtitle')}</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value={7}>{t('analytics.range.7d')}</option>
          <option value={30}>{t('analytics.range.30d')}</option>
          <option value={90}>{t('analytics.range.90d')}</option>
        </select>
      </div>

      {/* Post status stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label={t('analytics.stat.publishedPosts')} value={summary.publishedPosts} tone="emerald" />
        <StatCard icon={<Clock className="h-5 w-5" />} label={t('analytics.stat.scheduledPosts')} value={summary.scheduledPosts} tone="sky" />
        <StatCard icon={<XCircle className="h-5 w-5" />} label={t('analytics.stat.failedPosts')} value={summary.failedPosts} tone="rose" />
        <StatCard icon={<Link2 className="h-5 w-5" />} label={t('analytics.stat.connectedAccounts')} value={summary.connectedAccounts} tone="amber" />
      </div>

      {/* Engagement stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Eye className="h-5 w-5" />} label={t('analytics.stat.totalReach')} value={summary.totalReach.toLocaleString()} tone="sky" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label={t('analytics.stat.engagement')} value={summary.totalEngagement.toLocaleString()} tone="emerald" />
        <StatCard icon={<Activity className="h-5 w-5" />} label={t('analytics.stat.impressions')} value={summary.totalImpressions.toLocaleString()} tone="amber" />
        <StatCard icon={<MousePointerClick className="h-5 w-5" />} label={t('analytics.stat.clicks')} value={summary.totalClicks.toLocaleString()} tone="slate" />
      </div>

      {/* Posts breakdown + daily posts chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={t('analytics.postsBreakdown.title')} description={t('analytics.postsBreakdown.description')} className="lg:col-span-1">
          <DonutChart data={statusDonutData} centerValue={summary.totalPosts} centerLabel={t('analytics.stat.totalPosts')} emptyLabel={t('analytics.topPosts.empty')} />
        </Card>
        <Card title={t('analytics.dailyActivity.title')} description={t('analytics.dailyActivity.description', { days })} className="lg:col-span-2">
          <LineChart series={postsLineSeries} formatValue={(v) => `${v}`} />
        </Card>
      </div>

      {/* Reach chart */}
      <Card title={t('analytics.reachTrend.title')} description={t('analytics.reachTrend.description', { days })}>
        <LineChart series={reachLineSeries} formatValue={(v) => v.toLocaleString()} />
      </Card>

      {/* AI Usage section */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">{t('analytics.aiUsage.section')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Zap className="h-5 w-5" />} label={t('analytics.aiUsage.credits')} value={`${summary.aiUsage.creditsUsed.toLocaleString()} / ${summary.aiUsage.creditsLimit.toLocaleString()}`} hint={t('analytics.aiUsage.creditsPct', { pct: creditsPct })} tone="amber" />
          <StatCard icon={<Activity className="h-5 w-5" />} label={t('analytics.aiUsage.totalRequests')} value={summary.aiUsage.totalRequests} tone="sky" />
          <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label={t('analytics.aiUsage.successRate')} value={`${aiSuccessRate}%`} tone="emerald" />
          <StatCard icon={<XCircle className="h-5 w-5" />} label={t('analytics.aiUsage.failedRequests')} value={summary.aiUsage.failedRequests} tone="rose" />
        </div>
        <Card title={t('analytics.aiUsage.chart.title')} description={t('analytics.aiUsage.chart.description', { days })} className="mt-4">
          <BarChart data={aiRequestsBarData} color="#a855f7" formatValue={(v) => `${v}`} emptyLabel={t('analytics.aiUsage.chart.empty')} />
        </Card>
      </div>

      {/* Workspace Activity section */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">{t('analytics.workspaceActivity.section')}</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card title={t('analytics.workspaceActivity.byType.title')} description={t('analytics.workspaceActivity.byType.description')} className="lg:col-span-1">
            <DonutChart data={activityTypeDonutData} centerValue={summary.workspaceActivity.total} centerLabel={t('analytics.workspaceActivity.total')} emptyLabel={t('analytics.workspaceActivity.empty')} />
          </Card>
          <Card title={t('analytics.workspaceActivity.chart.title')} description={t('analytics.workspaceActivity.chart.description', { days })} className="lg:col-span-2">
            <BarChart data={activityBarData} color="#0ea5e9" formatValue={(v) => `${v}`} emptyLabel={t('analytics.workspaceActivity.empty')} />
          </Card>
        </div>
        <Card title={t('analytics.workspaceActivity.recent.title')} className="mt-4">
          {summary.workspaceActivity.recent.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-500">{t('analytics.workspaceActivity.empty')}</p>
          ) : (
            <div className="space-y-2">
              {summary.workspaceActivity.recent.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                  <p className="text-sm text-slate-700 dark:text-slate-300">{a.description}</p>
                  <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">{timeAgo(a.created_at, t)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Followers */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard icon={<Users className="h-5 w-5" />} label={t('analytics.stat.followers')} value={summary.totalFollowers.toLocaleString()} hint={t('analytics.stat.growth', { sign: summary.followersGrowth >= 0 ? '+' : '', growth: summary.followersGrowth })} tone="sky" />
        <StatCard icon={<CalendarClock className="h-5 w-5" />} label={t('analytics.stat.totalPosts')} value={summary.totalPosts} hint={t('analytics.stat.published', { count: summary.publishedPosts })} tone="slate" />
      </div>

      {/* Top performing posts */}
      <Card title={t('analytics.topPosts.title')} description={t('analytics.topPosts.description')}>
        {summary.topPosts.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('analytics.topPosts.empty')}</p>
        ) : (
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

const toneMap = {
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
};

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
