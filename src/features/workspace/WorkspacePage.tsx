import { useEffect, useState } from 'react';
import { Mail, Trash2, UserPlus, Users } from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { invitationRepository, workspaceMemberRepository, activityRepository } from '@/repositories/workspaceMemberRepository';
import { Badge, Button, Card, EmptyState, Input, Modal, Table, TableRow, TableCell } from '@/ui';
import { formatDate, timeAgo } from '@/utils/format';
import type { WorkspaceInvitation } from '@/types/social';
import type { WorkspaceMember } from '@/types/database';

export function WorkspacePage() {
  const { t } = useLanguage();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { push } = useToast();
  const [members, setMembers] = useState<(WorkspaceMember & { full_name: string | null })[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [activities, setActivities] = useState<{ id: string; type: string; description: string; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');

  const load = async () => {
    if (!workspace) return;
    try {
      setLoading(true);
      const [m, i, a] = await Promise.all([
        workspaceMemberRepository.list(workspace.id),
        invitationRepository.list(workspace.id),
        activityRepository.list(workspace.id, 20),
      ]);
      setMembers(m);
      setInvitations(i);
      setActivities(a);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [workspace?.id]);

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !workspace) return;
    try {
      await invitationRepository.create({ workspace_id: workspace.id, email: inviteEmail.trim(), role: inviteRole });
      await activityRepository.create({ workspace_id: workspace.id, type: 'invitation_sent', description: `Invited ${inviteEmail.trim()} as ${inviteRole}` });
      push({ title: t('workspace.toast.invitationSentTitle'), description: t('workspace.toast.invitationSentDesc', { email: inviteEmail.trim() }), variant: 'success' });
      setShowInvite(false);
      setInviteEmail('');
      load();
    } catch (e) {
      push({ title: t('workspace.toast.inviteFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await invitationRepository.revoke(id);
      setInvitations((prev) => prev.filter((i) => i.id !== id));
      push({ title: t('workspace.toast.invitationRevoked'), variant: 'success' });
    } catch (e) {
      push({ title: t('workspace.toast.revokeFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const handleRemoveMember = async (id: string) => {
    try {
      await workspaceMemberRepository.remove(id);
      setMembers((prev) => prev.filter((m) => m.id !== id));
      push({ title: t('workspace.toast.memberRemoved'), variant: 'success' });
    } catch (e) {
      push({ title: t('workspace.toast.removeFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const handleUpdateRole = async (id: string, role: string) => {
    try {
      await workspaceMemberRepository.updateRole(id, role);
      setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)));
      push({ title: t('workspace.toast.roleUpdated'), variant: 'success' });
    } catch (e) {
      push({ title: t('workspace.toast.roleUpdateFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  if (loading) return <p className="py-6 text-center text-sm text-slate-500">{t('workspace.loading')}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('workspace.title')}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('workspace.subtitle')}</p></div>
        <Button className="w-full sm:w-auto" onClick={() => setShowInvite(true)}><UserPlus className="h-4 w-4" /> {t('workspace.inviteMember')}</Button>
      </div>

      <Card title={t('workspace.members.title')} description={t('workspace.members.count', { count: members.length })}>
        {members.length === 0 ? <EmptyState icon={<Users className="h-10 w-10" />} title={t('workspace.members.empty.title')} description={t('workspace.members.empty.description')} /> : (
          <Table headers={[t('workspace.table.name'), t('workspace.table.role'), t('workspace.table.joined'), t('workspace.table.actions')]}>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell><div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">{(m.full_name ?? 'U').charAt(0).toUpperCase()}</div><span className="text-sm text-slate-900 dark:text-white">{m.full_name ?? t('workspace.unknownUser')}</span></div></TableCell>
                <TableCell>
                  <select value={m.role} onChange={(e) => handleUpdateRole(m.id, e.target.value)} disabled={m.user_id === user?.id} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    {['owner', 'admin', 'member', 'viewer'].map((r) => <option key={r} value={r}>{t(`workspace.role.${r}`)}</option>)}
                  </select>
                </TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{formatDate(m.created_at)}</TableCell>
                <TableCell>{m.user_id !== user?.id && <button onClick={() => handleRemoveMember(m.id)} className="flex h-9 w-9 items-center justify-center rounded text-slate-400 hover:text-rose-500"><Trash2 className="h-3.5 w-3.5" /></button>}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      {invitations.length > 0 && (
        <Card title={t('workspace.invitations.title')} description={t('workspace.invitations.count', { count: invitations.length })}>
          <div className="space-y-2">
            {invitations.map((i) => (
              <div key={i.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2"><Mail className="h-4 w-4 shrink-0 text-slate-400" /><div><p className="text-sm font-medium text-slate-900 dark:text-white">{i.email}</p><p className="text-xs text-slate-500 dark:text-slate-400">{t('workspace.invitations.invited', { time: timeAgo(i.created_at), date: formatDate(i.expires_at) })}</p></div></div>
                <div className="flex items-center gap-2"><Badge variant="info">{t(`workspace.role.${i.role}`)}</Badge><Button size="sm" variant="ghost" onClick={() => handleRevoke(i.id)}>{t('workspace.invitations.revoke')}</Button></div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card title={t('workspace.activity.title')} description={t('workspace.activity.description')}>
        {activities.length === 0 ? <EmptyState icon={<Users className="h-10 w-10" />} title={t('workspace.activity.empty.title')} description={t('workspace.activity.empty.description')} /> : (
          <ul className="space-y-3">
            {activities.map((a) => (
              <li key={a.id} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800"><Users className="h-3.5 w-3.5 text-slate-500" /></div>
                <div><p className="text-sm text-slate-900 dark:text-slate-100">{a.description}</p><p className="text-xs text-slate-500 dark:text-slate-400">{timeAgo(a.created_at)} · {a.type}</p></div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={showInvite} onClose={() => setShowInvite(false)} title={t('workspace.modal.inviteTitle')} size="sm" footer={<><Button variant="outline" onClick={() => setShowInvite(false)}>{t('common.cancel')}</Button><Button onClick={handleInvite}>{t('workspace.modal.sendInvite')}</Button></>}>
        <div className="space-y-4">
          <Input label={t('workspace.modal.emailLabel')} type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@example.com" autoFocus />
          <div><label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('workspace.modal.roleLabel')}</label><select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">{['admin', 'member', 'viewer'].map((r) => <option key={r} value={r}>{t(`workspace.role.${r}`)}</option>)}</select></div>
        </div>
      </Modal>
    </div>
  );
}
