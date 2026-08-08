import { useEffect, useState } from 'react';
import { Card, EmptyState, ErrorState, Table, TableCell, TableRow, TableSkeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { auditLogRepository } from '@/repositories/admin/auditLogRepository';
import type { AuditLog } from '@/types/database';
import { formatDateTime } from '@/utils/format';

export function AuditLogsPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    auditLogRepository
      .list()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.error.loadAuditLogsFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.auditLogs.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.auditLogs.subtitle')}</p>
      </div>

      <Card>
        {error && <ErrorState description={error} onRetry={load} />}
        {loading && !error && <TableSkeleton rows={8} cols={4} />}
        {!loading && !error && rows.length === 0 && <EmptyState title={t('admin.auditLogs.empty')} />}
        {!loading && !error && rows.length > 0 && (
          <Table
            headers={[
              t('admin.auditLogs.col.action'),
              t('admin.auditLogs.col.entity'),
              t('admin.auditLogs.col.actor'),
              t('admin.auditLogs.col.date'),
            ]}
          >
            {rows.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="font-medium text-slate-900 dark:text-white">{log.action}</TableCell>
                <TableCell>
                  {log.entity_type}
                  {log.entity_id ? ` · ${log.entity_id.slice(0, 8)}` : ''}
                </TableCell>
                <TableCell>{log.actor_email ?? log.actor_id?.slice(0, 8) ?? '—'}</TableCell>
                <TableCell>{formatDateTime(log.created_at)}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
