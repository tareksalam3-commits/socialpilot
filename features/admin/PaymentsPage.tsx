import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Table, TableCell, TableRow, TableSkeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { paymentsRepository, type AdminPaymentRow } from '@/repositories/admin/paymentsRepository';
import { formatDateTime } from '@/utils/format';

const statusVariant: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  paid: 'success',
  pending: 'warning',
  failed: 'error',
  refunded: 'default',
};

export function PaymentsPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<AdminPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    paymentsRepository
      .list()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.error.loadPaymentsFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.payments.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.payments.subtitle')}</p>
      </div>

      <Card>
        {error && <ErrorState description={error} onRetry={load} />}
        {loading && !error && <TableSkeleton rows={6} cols={5} />}
        {!loading && !error && rows.length === 0 && <EmptyState title={t('admin.payments.empty')} />}
        {!loading && !error && rows.length > 0 && (
          <Table
            headers={[
              t('admin.payments.col.workspace'),
              t('admin.payments.col.amount'),
              t('admin.payments.col.provider'),
              t('admin.payments.col.status'),
              t('admin.payments.col.date'),
            ]}
          >
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium text-slate-900 dark:text-white">{p.workspace_name}</TableCell>
                <TableCell>
                  {p.currency} {p.amount.toFixed(2)}
                </TableCell>
                <TableCell className="capitalize">{p.provider}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant[p.status] ?? 'default'} dot>
                    {t(`admin.paymentStatus.${p.status}`)}
                  </Badge>
                </TableCell>
                <TableCell>{formatDateTime(p.created_at)}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
