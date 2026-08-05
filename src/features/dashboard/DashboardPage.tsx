import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity as ActivityIcon, CalendarClock, Link2, Sparkles, TrendingUp, Zap } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useDashboardData } from '@/hooks/useDashboardData';
import { Badge, Button, Card, CardSkeleton, EmptyState, ErrorState } from '@/ui';
import { timeAgo } from '@/utils/format';

export function DashboardPage() {
  const { t } = useLanguage();
  const { user, profile } = useAuth();
  const { workspace, ensureWorkspace, loading: wsLoading } = useWorkspace();
  const navigate = useNavigate();
  const { connectedAccounts, scheduledPosts, aiUsage, recentActivity, loading, error } = useDashboardData(
    workspace?.id ?? null,
  );

  // Ensure the user has a workspace (created on first dashboard visit)
  useEffect(() => {
    if (!wsLoading && !workspace && user) {
      ensureWorkspace();
    }
  }, [wsLoading, workspace, user, ensureWorkspace]);

  const connectedCount = connectedAccounts.filter((a) => a.status === 'connected').length;
  const scheduledCount = scheduledPosts.filter((p) => p.status === 'scheduled').length;
  const creditsUsed = aiUsage?.credits_used ?? 0;
  const creditsLimit = aiUsage?.credits_limit ?? 1000;
  const creditsPct = Math.min(100, Math.round((creditsUsed / creditsLimit) * 100));

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('dashboard.welcomeBack', { name: profile?.full_name ?? user?.email?.split('@')[0] ?? 'there' })}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t('dashboard.subtitle', { workspace: workspace?.name ?? 'your workspace' })}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => navigate('/app/scheduled')}>
            <CalendarClock className="h-4 w-4" /> {t('dashboard.schedulePost')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/app/accounts')}>
            <Link2 className="h-4 w-4" /> {t('dashboard.connectAccount')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate('/app/settings')}>
            <Sparkles className="h-4 w-4" /> {t('dashboard.workspaceSettings')}
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent activity */}
        <Card className="lg:col-span-2" title={t('dashboard.recentActivity.title')} description={t('dashboard.recentActivity.description')}>
          {error ? (
            <ErrorState description={error} />
          ) : loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                  <div className="flex-1 space-y-1">
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-2 w-1/4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
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
        <Card title={t('dashboard.aiUsage.title')} description={t('dashboard.aiUsage.description')}>
          {error ? (
            <ErrorState description={error} />
          ) : loading ? (
            <div className="space-y-3">
              <div className="h-4 w-1/3 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              <div className="h-32 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline justify-between">
                <span className="text-3xl font-bold text-slate-900 dark:text-white">{creditsUsed}</span>
                <span className="text-sm text-slate-500 dark:text-slate-400">{t('dashboard.aiUsage.ofCredits', { limit: creditsLimit })}</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all"
                  style={{ width: `${creditsPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <Badge variant={creditsPct > 80 ? 'warning' : 'info'}>{t('dashboard.aiUsage.percentUsed', { pct: creditsPct })}</Badge>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {aiUsage ? t('dashboard.aiUsage.resets', { date: new Date(aiUsage.period_start).toLocaleDateString() }) : t('dashboard.aiUsage.noUsage')}
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
                <p className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('dashboard.aiUsage.hint')}
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Workspace info */}
      <Card title={t('dashboard.workspace.title')} description={t('dashboard.workspace.description')}>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <InfoItem label={t('dashboard.workspace.name')} value={workspace?.name ?? '—'} />
          <InfoItem label={t('dashboard.workspace.brandName')} value={workspace?.brand_name ?? '—'} />
          <InfoItem label={t('dashboard.workspace.language')} value={workspace?.language ?? 'en'} />
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
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneMap[tone]}`}>{icon}</div>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
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
