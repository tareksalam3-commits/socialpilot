import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Table, TableCell, TableRow, TableSkeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { adminWorkspacesRepository, type AdminWorkspaceRow } from '@/repositories/admin/adminWorkspacesRepository';
import { formatDate } from '@/utils/format';

const statusVariant: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  active: 'success',
  trialing: 'warning',
  past_due: 'warning',
  canceled: 'error',
  suspended: 'error',
};

export function AllWorkspacesPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const [rows, setRows] = useState<AdminWorkspaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<AdminWorkspaceRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    adminWorkspacesRepository
      .list()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load workspaces'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const remove = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await adminWorkspacesRepository.remove(target.id);
      push({ title: t('admin.workspaces.toast.removed'), variant: 'success' });
      setTarget(null);
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.workspaces.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.workspaces.subtitle')}</p>
      </div>

      <Card>
        {error && <ErrorState description={error} onRetry={load} />}
        {loading && !error && <TableSkeleton rows={6} cols={6} />}
        {!loading && !error && rows.length === 0 && <EmptyState title={t('admin.workspaces.empty')} />}
        {!loading && !error && rows.length > 0 && (
          <Table
            headers={[
              t('admin.workspaces.col.name'),
              t('admin.workspaces.col.members'),
              t('admin.workspaces.col.plan'),
              t('admin.workspaces.col.status'),
              t('admin.workspaces.col.created'),
              t('admin.workspaces.col.actions'),
            ]}
          >
            {rows.map((w) => (
              <TableRow key={w.id}>
                <TableCell className="font-medium text-slate-900 dark:text-white">{w.name}</TableCell>
                <TableCell>{w.member_count}</TableCell>
                <TableCell>{w.plan_name ?? '—'}</TableCell>
                <TableCell>
                  {w.subscription_status ? (
                    <Badge variant={statusVariant[w.subscription_status] ?? 'default'} dot>
                      {t(`admin.subscriptionStatus.${w.subscription_status}`)}
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>{formatDate(w.created_at)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="danger" onClick={() => setTarget(w)}>
                    <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      <Dialog
        open={!!target}
        title={t('admin.workspaces.confirm.title')}
        description={target ? t('admin.workspaces.confirm.desc', { name: target.name }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
