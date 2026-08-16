import { useEffect, useState } from 'react';
import { ChevronRight, LogOut, UserPlus, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { workspaceMembers, type WorkspaceMemberRow } from '@/lib/workspaceMembers';
import { Card, Button, Input, Badge, ErrorBanner, Spinner } from '@/components/ui';

const PLAN_LABELS: Record<string, string> = {
  free: 'مجانية',
  pro: 'احترافية',
  business: 'أعمال',
};

const ROLE_LABELS: Record<string, string> = {
  owner: 'مالك',
  admin: 'أدمن',
  member: 'عضو',
};

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { workspace, user, signOut, refreshWorkspace } = useAuth();
  const [name, setName] = useState(workspace?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [members, setMembers] = useState<WorkspaceMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const isOwner = !!workspace && !!user && workspace.owner_id === user.id;
  const dirty = workspace ? name.trim() !== workspace.name : false;

  async function loadMembers() {
    if (!workspace) return;
    setMembersLoading(true);
    setMembersError(null);
    try {
      const res = await workspaceMembers.list(workspace.id);
      setMembers(res.members);
    } catch (e) {
      setMembersError(e instanceof Error ? e.message : 'تعذّر تحميل أعضاء المساحة');
    } finally {
      setMembersLoading(false);
    }
  }

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  async function handleSave() {
    if (!workspace || !name.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    const { error: updateError } = await supabase
      .from('workspaces')
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', workspace.id);
    if (updateError) {
      setError('تعذّر حفظ اسم المساحة');
    } else {
      setSaved(true);
      await refreshWorkspace();
    }
    setSaving(false);
  }

  async function handleInvite() {
    if (!workspace || !inviteEmail.trim()) return;
    setInviting(true);
    setMembersError(null);
    setInviteNotice(null);
    try {
      const res = await workspaceMembers.invite(workspace.id, inviteEmail.trim());
      setInviteNotice(`تمت إضافة ${res.email} للمساحة`);
      setInviteEmail('');
      await loadMembers();
    } catch (e) {
      setMembersError(e instanceof Error ? e.message : 'تعذّر إضافة العضو');
    } finally {
      setInviting(false);
    }
  }

  async function handleRemove(member: WorkspaceMemberRow) {
    if (!workspace) return;
    setRemovingId(member.id);
    setMembersError(null);
    try {
      await workspaceMembers.remove(workspace.id, member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
    } catch (e) {
      setMembersError(e instanceof Error ? e.message : 'تعذّر إزالة العضو');
    } finally {
      setRemovingId(null);
    }
  }

  async function handleDeleteWorkspace() {
    if (!workspace || deleteInput.trim() !== workspace.name) return;
    setDeleting(true);
    setError(null);
    const { error: deleteError } = await supabase.from('workspaces').delete().eq('id', workspace.id);
    if (deleteError) {
      setError('تعذّر حذف المساحة');
      setDeleting(false);
      return;
    }
    await refreshWorkspace();
    setDeleting(false);
  }

  return (
    <div className="px-5 py-6 safe-top pb-24">
      <div className="flex items-center gap-2 mb-6">
        <button onClick={onBack} className="text-ink-400">
          <ChevronRight size={22} />
        </button>
        <h1 className="text-lg font-bold text-ink-50">إعدادات المساحة</h1>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <Card className="mb-4">
        <p className="text-ink-500 text-xs mb-2">اسم المساحة</p>
        <Input value={name} onChange={setName} placeholder="اسم المساحة" />
        {!isOwner && (
          <p className="text-ink-600 text-[11px] mt-2">
            تقدر تعدّل الاسم لو انت مالك المساحة بس
          </p>
        )}
        {dirty && isOwner && (
          <Button className="mt-3 w-full" onClick={handleSave} disabled={saving}>
            {saving ? '...جارٍ الحفظ' : 'حفظ التغييرات'}
          </Button>
        )}
        {saved && !dirty && (
          <p className="text-brand-400 text-xs mt-2">تم الحفظ بنجاح</p>
        )}
      </Card>

      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-ink-500 text-xs">الباقة</span>
          <Badge color="brand">{PLAN_LABELS[workspace?.plan ?? 'free'] ?? workspace?.plan}</Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-ink-500 text-xs">دورك في المساحة</span>
          <Badge color="neutral">{isOwner ? 'مالك' : 'عضو'}</Badge>
        </div>
      </Card>

      <Card className="mb-4">
        <p className="text-ink-500 text-xs mb-1">البريد الإلكتروني</p>
        <p className="text-ink-200 text-sm" dir="ltr">{user?.email}</p>
      </Card>

      {/* Members */}
      <div className="mb-4">
        <p className="text-ink-500 text-xs mb-2">أعضاء المساحة</p>
        <Card>
          {membersError && (
            <div className="mb-3">
              <ErrorBanner message={membersError} />
            </div>
          )}
          {inviteNotice && (
            <div className="mb-3 rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-300 text-sm px-3 py-2">
              {inviteNotice}
            </div>
          )}

          {membersLoading ? (
            <div className="flex justify-center py-6">
              <Spinner className="text-brand-400" />
            </div>
          ) : (
            <div className="flex flex-col gap-2 mb-3">
              {members.map((m) => (
                <div key={m.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-ink-200 text-sm truncate" dir="ltr">
                      {m.email ?? m.user_id}
                    </span>
                    <Badge color={m.role === 'owner' ? 'brand' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
                  </div>
                  {isOwner && m.role !== 'owner' && (
                    <button
                      onClick={() => handleRemove(m)}
                      disabled={removingId === m.id}
                      className="text-danger-400 text-xs px-2 py-1 disabled:opacity-40"
                    >
                      {removingId === m.id ? '...' : 'إزالة'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isOwner && (
            <div className="flex items-center gap-2 pt-2 border-t border-ink-800">
              <Input value={inviteEmail} onChange={setInviteEmail} placeholder="بريد العضو الإلكتروني" />
              <Button size="sm" onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                {inviting ? '...' : <UserPlus size={16} />}
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Danger zone */}
      {isOwner && (
        <Card className="mb-4 border-danger-500/30">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-danger-400" />
            <p className="text-danger-400 text-sm font-medium">حذف المساحة نهائيًا</p>
          </div>
          <p className="text-ink-500 text-xs mb-3">
            هيتم حذف كل المحتوى، الحسابات المربوطة، وسجل الاستخدام بشكل نهائي ولا يمكن التراجع عنه.
          </p>
          {!confirmingDelete ? (
            <Button variant="danger" size="sm" onClick={() => setConfirmingDelete(true)}>
              <span className="flex items-center gap-2">
                <Trash2 size={14} /> حذف المساحة
              </span>
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-ink-400 text-xs">
                اكتب اسم المساحة <span className="text-ink-200 font-medium">"{workspace?.name}"</span> للتأكيد
              </p>
              <Input value={deleteInput} onChange={setDeleteInput} placeholder={workspace?.name ?? ''} />
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  className="flex-1"
                  disabled={deleteInput.trim() !== workspace?.name || deleting}
                  onClick={handleDeleteWorkspace}
                >
                  {deleting ? '...جارٍ الحذف' : 'تأكيد الحذف'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteInput('');
                  }}
                >
                  إلغاء
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Button variant="ghost" size="lg" onClick={signOut} className="w-full text-danger-400">
        <span className="flex items-center justify-center gap-2">
          <LogOut size={18} /> تسجيل الخروج
        </span>
      </Button>
    </div>
  );
}
