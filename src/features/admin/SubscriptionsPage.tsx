import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Select, Table, TableCell, TableRow, TableSkeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { subscriptionsRepository, type AdminSubscriptionRow } from '@/repositories/admin/subscriptionsRepository';
import type { SubscriptionStatus } from '@/types/database';
import { formatDate } from '@/utils/format';

const STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'canceled', 'suspended'];

const statusVariant: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  active: 'success',
  trialing: 'warning',
  past_due: 'warning',
  canceled: 'error',
  suspended: 'error',
};

export function SubscriptionsPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const [rows, setRows] = useState<AdminSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    subscriptionsRepository
      .list()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.error.loadSubscriptionsFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const changeStatus = async (id: string, status: SubscriptionStatus) => {
    const previous = rows;
    setRows((r) => r.map((row) => (row.id === id ? { ...row, status } : row)));
    try {
      await subscriptionsRepository.updateStatus(id, status);
      push({ title: t('admin.subscriptions.toast.updated'), variant: 'success' });
    } catch (e) {
      setRows(previous);
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.subscriptions.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.subscriptions.subtitle')}</p>
      </div>

      <Card>
        {error && <ErrorState description={error} onRetry={load} />}
        {loading && !error && <TableSkeleton rows={6} cols={5} />}
        {!loading && !error && rows.length === 0 && <EmptyState title={t('admin.subscriptions.empty')} />}
        {!loading && !error && rows.length > 0 && (
          <Table
            headers={[
              t('admin.subscriptions.col.workspace'),
              t('admin.subscriptions.col.plan'),
              t('admin.subscriptions.col.status'),
              t('admin.subscriptions.col.periodEnd'),
              t('admin.subscriptions.col.actions'),
            ]}
          >
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium text-slate-900 dark:text-white">{s.workspace_name}</TableCell>
                <TableCell>{s.plan_name ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant[s.status] ?? 'default'} dot>
                    {t(`admin.subscriptionStatus.${s.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>{s.current_period_end ? formatDate(s.current_period_end) : '—'}</TableCell>
                <TableCell>
                  <Select
                    value={s.status}
                    onChange={(e) => changeStatus(s.id, e.target.value as SubscriptionStatus)}
                    className="w-40"
                  >
                    {STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {t(`admin.subscriptionStatus.${st}`)}
                      </option>
                    ))}
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
