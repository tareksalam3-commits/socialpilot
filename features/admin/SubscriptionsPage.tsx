import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Select, Table, TableCell, TableRow, TableSkeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import {
  subscriptionsRepository,
  type AdminSubscriptionRow,
  type SubscriptionBillingCycle,
} from '@/repositories/admin/subscriptionsRepository';
import { plansRepository } from '@/repositories/admin/plansRepository';
import type { SubscriptionPlan, SubscriptionStatus } from '@/types/database';
import { formatDate } from '@/utils/format';

const STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'canceled', 'suspended'];
const BILLING_CYCLES: SubscriptionBillingCycle[] = ['monthly', 'quarterly', 'yearly'];
const BILLING_CYCLE_MONTHS: Record<SubscriptionBillingCycle, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

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
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingPlanId, setUpdatingPlanId] = useState<string | null>(null);
  const [updatingCycleId, setUpdatingCycleId] = useState<string | null>(null);
  const [updatingStatusId, setUpdatingStatusId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([subscriptionsRepository.list(), plansRepository.list()])
      .then(([subscriptions, availablePlans]) => {
        setRows(subscriptions);
        setPlans(availablePlans);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.error.loadSubscriptionsFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const changeBillingCycle = async (subscription: AdminSubscriptionRow, billingCycle: SubscriptionBillingCycle) => {
    if (billingCycle === subscription.billing_cycle) return;

    const currentPeriodStart = new Date();
    const currentPeriodEnd = new Date(currentPeriodStart);
    currentPeriodEnd.setUTCMonth(currentPeriodEnd.getUTCMonth() + BILLING_CYCLE_MONTHS[billingCycle]);
    const previous = rows;
    setUpdatingCycleId(subscription.id);
    setRows((current) => current.map((row) => (
      row.id === subscription.id
        ? {
            ...row,
            billing_cycle: billingCycle,
            current_period_start: currentPeriodStart.toISOString(),
            current_period_end: currentPeriodEnd.toISOString(),
          }
        : row
    )));
    try {
      await subscriptionsRepository.changeBillingCycle(
        subscription.id,
        billingCycle,
        currentPeriodStart.toISOString(),
        currentPeriodEnd.toISOString(),
      );
      push({ title: t('admin.subscriptions.toast.billingCycleChanged'), variant: 'success' });
    } catch (e) {
      setRows(previous);
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setUpdatingCycleId(null);
    }
  };

  const changeStatus = async (id: string, status: SubscriptionStatus) => {
    const previous = rows;
    setUpdatingStatusId(id);
    setRows((r) => r.map((row) => (row.id === id ? { ...row, status } : row)));
    try {
      await subscriptionsRepository.updateStatus(id, status);
      push({ title: t('admin.subscriptions.toast.updated'), variant: 'success' });
    } catch (e) {
      setRows(previous);
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setUpdatingStatusId(null);
    }
  };

  const changePlan = async (subscription: AdminSubscriptionRow, planId: string) => {
    if (!planId || planId === subscription.plan_id) return;
    const selectedPlan = plans.find((plan) => plan.id === planId);
    if (!selectedPlan) return;

    const previous = rows;
    setUpdatingPlanId(subscription.id);
    setRows((current) => current.map((row) => (
      row.id === subscription.id
        ? { ...row, plan_id: planId, plan_name: selectedPlan.name }
        : row
    )));
    try {
      await subscriptionsRepository.changePlan(subscription.id, planId);
      push({ title: t('admin.subscriptions.toast.planChanged', { plan: selectedPlan.name }), variant: 'success' });
    } catch (e) {
      setRows(previous);
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setUpdatingPlanId(null);
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
        {loading && !error && <TableSkeleton rows={6} cols={6} />}
        {!loading && !error && rows.length === 0 && <EmptyState title={t('admin.subscriptions.empty')} />}
        {!loading && !error && rows.length > 0 && (
          <Table
            headers={[
              t('admin.subscriptions.col.workspace'),
              t('admin.subscriptions.col.plan'),
              t('admin.subscriptions.col.billingCycle'),
              t('admin.subscriptions.col.status'),
              t('admin.subscriptions.col.periodEnd'),
              t('admin.subscriptions.col.actions'),
            ]}
          >
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium text-slate-900 dark:text-white">{s.workspace_name}</TableCell>
                <TableCell>
                  <Select
                    value={s.plan_id ?? ''}
                    onChange={(e) => changePlan(s, e.target.value)}
                    disabled={updatingPlanId === s.id}
                    className="w-44"
                    aria-label={t('admin.subscriptions.changePlan')}
                  >
                    {!s.plan_id && <option value="">{t('admin.subscriptions.noPlan')}</option>}
                    {plans.filter((plan) => plan.is_active || plan.id === s.plan_id).map((plan) => (
                      <option key={plan.id} value={plan.id}>{plan.name}</option>
                    ))}
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={s.billing_cycle}
                    onChange={(e) => changeBillingCycle(s, e.target.value as SubscriptionBillingCycle)}
                    disabled={updatingCycleId === s.id}
                    className="w-36"
                    aria-label={t('admin.subscriptions.changeBillingCycle')}
                  >
                    {BILLING_CYCLES.map((cycle) => (
                      <option key={cycle} value={cycle}>{t(`admin.billingCycle.${cycle}`)}</option>
                    ))}
                  </Select>
                </TableCell>
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
                    disabled={updatingStatusId === s.id}
                    className="w-40"
                    aria-label={t('admin.subscriptions.changeStatus')}
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
