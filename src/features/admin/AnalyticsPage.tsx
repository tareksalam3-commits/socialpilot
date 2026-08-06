import { useEffect, useState } from 'react';
import { Card, EmptyState, ErrorState, Table, TableCell, TableRow, TableSkeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { aiCreditsRepository, type AdminAiCreditRow } from '@/repositories/admin/aiCreditsRepository';
import { adminAnalyticsRepository, type PlatformSummary } from '@/repositories/admin/adminAnalyticsRepository';

export function AnalyticsPage() {
  const { t } = useLanguage();
  const [summary, setSummary] = useState<PlatformSummary | null>(null);
  const [credits, setCredits] = useState<AdminAiCreditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([adminAnalyticsRepository.summary(), aiCreditsRepository.list()])
      .then(([s, c]) => {
        setSummary(s);
        setCredits(c);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load analytics'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const topByUsage = [...credits].sort((a, b) => b.credits_used - a.credits_used).slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.analytics.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.analytics.subtitle')}</p>
      </div>

      {error && <ErrorState description={error} onRetry={load} />}

      {loading && !error && <TableSkeleton rows={6} cols={3} />}

      {!loading && !error && summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card title={t('admin.analytics.avgCreditsPerWorkspace')}>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">
              {summary.totalWorkspaces > 0 ? Math.round(summary.aiCreditsUsed / summary.totalWorkspaces).toLocaleString() : 0}
            </p>
          </Card>
          <Card title={t('admin.analytics.revenuePerWorkspace')}>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">
              ${summary.totalWorkspaces > 0 ? (summary.totalRevenue / summary.totalWorkspaces).toFixed(2) : '0.00'}
            </p>
          </Card>
          <Card title={t('admin.analytics.subscriptionRate')}>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">
              {summary.totalWorkspaces > 0 ? Math.round((summary.activeSubscriptions / summary.totalWorkspaces) * 100) : 0}%
            </p>
          </Card>
        </div>
      )}

      <Card title={t('admin.analytics.topUsage.title')} description={t('admin.analytics.topUsage.subtitle')}>
        {!loading && topByUsage.length === 0 && <EmptyState title={t('admin.aiCredits.empty')} />}
        {topByUsage.length > 0 && (
          <Table headers={[t('admin.aiCredits.col.workspace'), t('admin.aiCredits.col.used'), t('admin.aiCredits.col.limit')]}>
            {topByUsage.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-slate-900 dark:text-white">{row.workspace_name}</TableCell>
                <TableCell>{row.credits_used.toLocaleString()}</TableCell>
                <TableCell>{row.credits_limit.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
