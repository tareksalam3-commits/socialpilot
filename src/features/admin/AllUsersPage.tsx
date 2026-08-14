import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, UserX } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Table, TableCell, TableRow, TableSkeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { useAuth } from '@/providers/AuthProvider';
import { adminUsersRepository } from '@/repositories/admin/adminUsersRepository';
import type { AdminUserRow } from '@/types/database';
import { formatDate } from '@/utils/format';

export function AllUsersPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ user: AdminUserRow; action: 'promote' | 'demote' | 'ban' | 'unban' } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    adminUsersRepository
      .list()
      .then((res) => setUsers(res.users))
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.error.loadUsersFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const runAction = async () => {
    if (!confirmTarget) return;
    setBusy(true);
    try {
      const { user, action } = confirmTarget;
      if (action === 'promote') await adminUsersRepository.setPlatformRole(user.user_id, 'super_admin');
      if (action === 'demote') await adminUsersRepository.setPlatformRole(user.user_id, 'user');
      if (action === 'ban') await adminUsersRepository.setBanned(user.user_id, true);
      if (action === 'unban') await adminUsersRepository.setBanned(user.user_id, false);
      push({ title: t('admin.users.toast.updated'), variant: 'success' });
      setConfirmTarget(null);
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
        <h1 className="text-2xl font-bold text-white">{t('admin.users.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.users.subtitle')}</p>
      </div>

      <Card>
        {error && <ErrorState description={error} onRetry={load} />}
        {loading && !error && <TableSkeleton rows={6} cols={5} />}
        {!loading && !error && users.length === 0 && <EmptyState title={t('admin.users.empty')} />}
        {!loading && !error && users.length > 0 && (
          <Table
            headers={[
              t('admin.users.col.name'),
              t('admin.users.col.email'),
              t('admin.users.col.role'),
              t('admin.users.col.workspaces'),
              t('admin.users.col.joined'),
              t('admin.users.col.actions'),
            ]}
          >
            {users.map((u) => (
              <TableRow key={u.user_id}>
                <TableCell className="font-medium text-slate-900 dark:text-white">{u.full_name ?? '—'}</TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell>
                  {u.platform_role === 'super_admin' ? (
                    <Badge variant="info" dot>
                      {t('admin.role.superAdmin')}
                    </Badge>
                  ) : (
                    <Badge dot>{t('admin.role.user')}</Badge>
                  )}
                  {u.banned && (
                    <Badge variant="error" className="ms-1.5">
                      {t('admin.users.banned')}
                    </Badge>
                  )}
                </TableCell>
                <TableCell>{u.workspaces.length}</TableCell>
                <TableCell>{formatDate(u.created_at)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    {u.platform_role === 'super_admin' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={u.user_id === currentUser?.id}
                        onClick={() => setConfirmTarget({ user: u, action: 'demote' })}
                      >
                        <ShieldOff className="h-3.5 w-3.5" /> {t('admin.users.action.demote')}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setConfirmTarget({ user: u, action: 'promote' })}>
                        <ShieldCheck className="h-3.5 w-3.5" /> {t('admin.users.action.promote')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={u.banned ? 'outline' : 'danger'}
                      disabled={u.user_id === currentUser?.id}
                      onClick={() => setConfirmTarget({ user: u, action: u.banned ? 'unban' : 'ban' })}
                    >
                      <UserX className="h-3.5 w-3.5" /> {u.banned ? t('admin.users.action.unban') : t('admin.users.action.ban')}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      <Dialog
        open={!!confirmTarget}
        title={confirmTarget ? t(`admin.users.confirm.${confirmTarget.action}.title`) : ''}
        description={confirmTarget ? t(`admin.users.confirm.${confirmTarget.action}.desc`, { name: confirmTarget.user.full_name ?? confirmTarget.user.email }) : ''}
        confirmLabel={t('common.confirm')}
        cancelLabel={t('common.cancel')}
        variant={confirmTarget?.action === 'ban' || confirmTarget?.action === 'demote' ? 'danger' : 'default'}
        loading={busy}
        onConfirm={runAction}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
