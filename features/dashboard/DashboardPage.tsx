import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity as ActivityIcon, Brain, CalendarClock, Link2, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useContentInsights } from '@/hooks/useContentInsights';
import { AnalyticsOverview } from '@/features/analytics/AnalyticsPage';
import { Badge, Button, Card, CardSkeleton, EmptyState, ErrorState, Skeleton } from '@/ui';
import { timeAgo } from '@/utils/format';

export function DashboardPage() {
  const { t } = useLanguage();
  const { user, profile } = useAuth();
  const { workspace, ensureWorkspace, loading: wsLoading } = useWorkspace();
  const navigate = useNavigate();
  const { connectedAccounts, scheduledPosts, aiUsage, recentActivity, loading, error } = useDashboardData(
    workspace?.id ?? null,
  );
  const { learnings, recommendations, loading: insightsLoading } = useContentInsights();

  // Ensure the user has a workspace (created on first dashboard visit)
  useEffect(() => {
    if (!wsLoading && !workspace && user) {
      ensureWorkspace();
    }
  }, [wsLoading, workspace, user, ensureWorkspace]);

  const connectedCount = connectedAccounts.filter((a) => a.status === 'connected').length;
  const scheduledCount = scheduledPosts.filter((p) => p.status === 'scheduled').length;
  const creditsUsed = aiUsage?.credits_used ?? 0;
  const creditsLimit = aiUsage?.credits_limit ?? 200;
  const creditsPct = Math.min(100, Math.round((creditsUsed / creditsLimit) * 100));
  const activeRecommendations = recommendations.filter((item) => item.status !== 'DISMISSED' && item.status !== 'EXPIRED').slice(0, 3);
  const activeLearnings = learnings.filter((item) => item.status === 'ACTIVE').slice(0, 2);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Welcome */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950 sm:p-6">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white sm:text-2xl">
          {t('dashboard.welcomeBack', { name: profile?.full_name ?? user?.email?.split('@')[0] ?? 'there' })}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t('dashboard.subtitle', { workspace: workspace?.name ?? 'your workspace' })}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <Button size="sm" className="w-full sm:w-auto" onClick={() => navigate('/app/playground')}>
            <Sparkles className="h-4 w-4" /> {t('home.openContentWorkspace')}
          </Button>
          <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/app/posts')}>
            <CalendarClock className="h-4 w-4" /> {t('dashboard.schedulePost')}
          </Button>
          <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/app/accounts')}>
            <Link2 className="h-4 w-4" /> {t('dashboard.connectAccount')}
          </Button>
          <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/app/settings')}>
            <Sparkles className="h-4 w-4" /> {t('dashboard.workspaceSettings')}
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            icon={<Link2 className="h-5 w-5" />}
            label={t('dashboard.stat.connectedAccounts')}
            value={connectedCount}
            hint={t('dashboard.stat.total', { count: connectedAccounts.length })}
            tone="sky"
          />
          <StatCard
            icon={<CalendarClock className="h-5 w-5" />}
            label={t('dashboard.stat.scheduledPosts')}
            value={scheduledCount}
            hint={t('dashboard.stat.total', { count: scheduledPosts.length })}
            tone="emerald"
          />
          <StatCard
            icon={<Zap className="h-5 w-5" />}
            label={t('dashboard.stat.aiCreditsUsed')}
            value={creditsUsed}
            hint={t('dashboard.stat.ofThisPeriod', { limit: creditsLimit })}
            tone="amber"
          />
          <StatCard
            icon={<TrendingUp className="h-5 w-5" />}
            label={t('dashboard.stat.recentActivity')}
            value={recentActivity.length}
            hint={t('dashboard.stat.last30Days')}
            tone="slate"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Recent activity */}
        <Card className="lg:col-span-2" title={t('dashboard.recentActivity.title')} description={t('dashboard.recentActivity.description')}>
          {error ? (
            <ErrorState description={error} />
          ) : loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-2 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <EmptyState
              icon={<ActivityIcon className="h-10 w-10" />}
              title={t('dashboard.recentActivity.empty.title')}
              description={t('dashboard.recentActivity.empty.description')}
            />
          ) : (
            <ul className="space-y-3">
              {recentActivity.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    <ActivityIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-900 dark:text-slate-100">{a.description}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {timeAgo(a.created_at)} · {a.type}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* AI usage */}
        <Card
          title={t('dashboard.aiUsage.title')}
          description={t('dashboard.aiUsage.description')}
          action={aiUsage?.plan_name ? <Badge variant="info">{t('dashboard.aiUsage.plan', { plan: aiUsage.plan_name })}</Badge> : undefined}
        >
          {error ? (
            <ErrorState description={error} />
          ) : loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">{creditsUsed}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.aiUsage.ofCredits', { limit: creditsLimit })}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all"
                  style={{ width: `${creditsPct}%` }}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant={creditsPct > 80 ? 'warning' : 'info'}>{t('dashboard.aiUsage.percentUsed', { pct: creditsPct })}</Badge>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {aiUsage
                    ? t('dashboard.aiUsage.resets', {
                        date: new Date(aiUsage.current_period_end ?? aiUsage.period_start).toLocaleDateString(),
                      })
                    : t('dashboard.aiUsage.noUsage')}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                <p className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  {t('dashboard.aiUsage.hint')}
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Prioritised insights — sourced from the existing learning and recommendation engines. */}
      <Card
        title={t('home.insights.title')}
        description={t('home.insights.description')}
        action={<Button variant="outline" size="sm" onClick={() => navigate('/app/insights')}>{t('home.insights.viewAll')}</Button>}
      >
        {insightsLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : activeRecommendations.length === 0 && activeLearnings.length === 0 ? (
          <EmptyState
            icon={<Brain className="h-9 w-9" />}
            title={t('home.insights.empty.title')}
            description={t('home.insights.empty.description')}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {activeRecommendations.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">{t('home.insights.recommendation')}</p>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{item.recommendation}</p>
                {item.reason && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.reason}</p>}
              </div>
            ))}
            {activeLearnings.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">{t('home.insights.learning')}</p>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{item.learning}</p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Performance, published content and activity stay powered by the original analytics hook. */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('home.performance.title')}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('home.performance.description')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/app/analytics')}>{t('home.performance.viewDetails')}</Button>
        </div>
        <AnalyticsOverview />
      </section>

      {/* Workspace info */}
      <Card title={t('dashboard.workspace.title')} description={t('dashboard.workspace.description')}>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <InfoItem label={t('dashboard.workspace.name')} value={workspace?.name ?? '—'} />
          <InfoItem label={t('dashboard.workspace.brandName')} value={workspace?.brand_name ?? '—'} />
          <InfoItem label={t('dashboard.workspace.language')} value={workspace?.language ?? 'ar'} />
        </dl>
      </Card>
    </div>
  );
}

const toneMap = {
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
  tone: keyof typeof toneMap;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 sm:p-5">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg sm:h-10 sm:w-10 ${toneMap[tone]}`}>{icon}</div>
      </div>
      <p className="mt-2.5 text-lg font-bold text-slate-900 dark:text-white sm:mt-3 sm:text-2xl">{value}</p>
      <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-300 sm:text-sm">{label}</p>
      <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">{hint}</p>
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}
