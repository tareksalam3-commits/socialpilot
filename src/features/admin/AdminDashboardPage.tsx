import { useEffect, useState } from 'react';
import { Activity, Bot, CreditCard, Layers, Users as UsersIcon, Wallet } from 'lucide-react';
import { Card, ErrorState, Skeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { adminAnalyticsRepository, type PlatformSummary } from '@/repositories/admin/adminAnalyticsRepository';

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof UsersIcon; label: string; value: string; accent: string }) {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
          <p className="mt-0.5 truncate text-xl font-bold text-slate-900 dark:text-white">{value}</p>
        </div>
      </div>
    </Card>
  );
}

export function AdminDashboardPage() {
  const { t } = useLanguage();
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    adminAnalyticsRepository
      .summary()
      .then(setSummary)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.dashboard.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.dashboard.subtitle')}</p>
      </div>

      {error && <ErrorState description={error} onRetry={load} />}

      {loading && !error ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="mb-2 h-4 w-1/2" />
              <Skeleton className="h-7 w-1/3" />
            </Card>
          ))}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            icon={UsersIcon}
            label={t('admin.dashboard.totalUsers')}
            value={summary.totalUsers.toLocaleString()}
            accent="bg-indigo-500/15 text-indigo-400"
          />
          <StatCard
            icon={Layers}
            label={t('admin.dashboard.totalWorkspaces')}
            value={summary.totalWorkspaces.toLocaleString()}
            accent="bg-sky-500/15 text-sky-400"
          />
          <StatCard
            icon={Wallet}
            label={t('admin.dashboard.activeSubscriptions')}
            value={summary.activeSubscriptions.toLocaleString()}
            accent="bg-emerald-500/15 text-emerald-400"
          />
          <StatCard
            icon={CreditCard}
            label={t('admin.dashboard.totalRevenue')}
            value={`$${summary.totalRevenue.toLocaleString()}`}
            accent="bg-amber-500/15 text-amber-400"
          />
          <StatCard
            icon={Bot}
            label={t('admin.dashboard.aiCreditsUsed')}
            value={`${summary.aiCreditsUsed.toLocaleString()} / ${summary.aiCreditsLimit.toLocaleString()}`}
            accent="bg-fuchsia-500/15 text-fuchsia-400"
          />
          <StatCard
            icon={Activity}
            label={t('admin.dashboard.creditUtilization')}
            value={summary.aiCreditsLimit > 0 ? `${Math.round((summary.aiCreditsUsed / summary.aiCreditsLimit) * 100)}%` : '—'}
            accent="bg-rose-500/15 text-rose-400"
          />
        </div>
      ) : null}
    </div>
  );
}
