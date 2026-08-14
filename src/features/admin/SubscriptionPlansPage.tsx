import { useEffect, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, Modal, Skeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { plansRepository } from '@/repositories/admin/plansRepository';
import type { SubscriptionPlan } from '@/types/database';

type FormState = {
  id: string | null;
  name: string;
  slug: string;
  price_monthly: string;
  price_quarterly: string;
  price_yearly: string;
  ai_credits_included: string;
  max_seats: string;
  max_connected_accounts: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  id: null,
  name: '',
  slug: '',
  price_monthly: '0',
  price_quarterly: '0',
  price_yearly: '0',
  ai_credits_included: '200',
  max_seats: '1',
  max_connected_accounts: '3',
  is_active: true,
};

export function SubscriptionPlansPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    plansRepository
      .list()
      .then(setPlans)
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.error.loadPlansFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openCreate = () => setForm(emptyForm);
  const openEdit = (p: SubscriptionPlan) =>
    setForm({
      id: p.id,
      name: p.name,
      slug: p.slug,
      price_monthly: String(p.price_monthly),
      price_quarterly: String(p.price_quarterly),
      price_yearly: String(p.price_yearly),
      ai_credits_included: String(p.ai_credits_included),
      max_seats: String(p.max_seats),
      max_connected_accounts: String(p.max_connected_accounts),
      is_active: p.is_active,
    });

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        slug: form.slug,
        price_monthly: Number(form.price_monthly) || 0,
        price_quarterly: Number(form.price_quarterly) || 0,
        price_yearly: Number(form.price_yearly) || 0,
        ai_credits_included: Number(form.ai_credits_included) || 0,
        max_seats: Number(form.max_seats) || 1,
        max_connected_accounts: Number(form.max_connected_accounts) || 1,
        is_active: form.is_active,
      };
      if (form.id) await plansRepository.update(form.id, payload);
      else await plansRepository.create(payload);
      push({ title: t('admin.plans.toast.saved'), variant: 'success' });
      setForm(null);
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await plansRepository.remove(deleteTarget.id);
      push({ title: t('admin.plans.toast.removed'), variant: 'success' });
      setDeleteTarget(null);
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('admin.plans.title')}</h1>
          <p className="mt-1 text-sm text-slate-400">{t('admin.plans.subtitle')}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" /> {t('admin.plans.new')}
        </Button>
      </div>

      {error && <ErrorState description={error} onRetry={load} />}

      {loading && !error && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="mb-3 h-5 w-1/2" />
              <Skeleton className="mb-2 h-8 w-1/3" />
              <Skeleton className="h-4 w-full" />
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && plans.length === 0 && <EmptyState title={t('admin.plans.empty')} />}

      {!loading && !error && plans.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.id} title={p.name} description={`${p.slug}`} action={!p.is_active ? <Badge variant="warning">{t('admin.plans.inactive')}</Badge> : undefined}>
              <p className="text-2xl font-bold text-slate-900 dark:text-white">
                ${p.price_monthly}
                <span className="text-sm font-normal text-slate-500 dark:text-slate-400"> /{t('admin.plans.perMonth')}</span>
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t('admin.plans.priceQuarterly', { price: p.price_quarterly })} · {t('admin.plans.priceYearly', { price: p.price_yearly })}
              </p>
              <ul className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                <li>{t('admin.plans.aiCredits', { count: p.ai_credits_included })}</li>
                <li>{t('admin.plans.seats', { count: p.max_seats })}</li>
                <li>{t('admin.plans.connectedAccounts', { count: p.max_connected_accounts })}</li>
              </ul>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                  <Pencil className="h-3.5 w-3.5" /> {t('common.edit')}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setDeleteTarget(p)}>
                  <Trash2 className="h-3.5 w-3.5" /> {t('common.delete')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? t('admin.plans.editTitle') : t('admin.plans.new')}>
        {form && (
          <div className="space-y-4">
            <Input label={t('admin.plans.field.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label={t('admin.plans.field.slug')} value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input
                label={t('admin.plans.field.priceMonthly')}
                type="number"
                value={form.price_monthly}
                onChange={(e) => setForm({ ...form, price_monthly: e.target.value })}
              />
              <Input
                label={t('admin.plans.field.priceQuarterly')}
                type="number"
                value={form.price_quarterly}
                onChange={(e) => setForm({ ...form, price_quarterly: e.target.value })}
              />
              <Input
                label={t('admin.plans.field.priceYearly')}
                type="number"
                value={form.price_yearly}
                onChange={(e) => setForm({ ...form, price_yearly: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Input
                label={t('admin.plans.field.aiCredits')}
                type="number"
                value={form.ai_credits_included}
                onChange={(e) => setForm({ ...form, ai_credits_included: e.target.value })}
              />
              <Input
                label={t('admin.plans.field.seats')}
                type="number"
                value={form.max_seats}
                onChange={(e) => setForm({ ...form, max_seats: e.target.value })}
              />
              <Input
                label={t('admin.plans.field.accounts')}
                type="number"
                value={form.max_connected_accounts}
                onChange={(e) => setForm({ ...form, max_connected_accounts: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t('admin.plans.field.active')}
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={save} loading={saving} disabled={!form.name || !form.slug}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Dialog
        open={!!deleteTarget}
        title={t('admin.plans.confirmDelete.title')}
        description={deleteTarget ? t('admin.plans.confirmDelete.desc', { name: deleteTarget.name }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        loading={busy}
        onConfirm={remove}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
