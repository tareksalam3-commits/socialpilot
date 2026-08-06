import { supabase } from '@/services/supabase';
import type { Subscription, SubscriptionStatus } from '@/types/database';

export type AdminSubscriptionRow = Subscription & {
  workspace_name: string;
  plan_name: string | null;
};

export const subscriptionsRepository = {
  async list(): Promise<AdminSubscriptionRow[]> {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*, workspaces(name), subscription_plans(name)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    type Row = Subscription & { workspaces: { name: string } | null; subscription_plans: { name: string } | null };
    return ((data ?? []) as unknown as Row[]).map((s) => ({
      ...s,
      workspace_name: s.workspaces?.name ?? '—',
      plan_name: s.subscription_plans?.name ?? null,
    }));
  },

  async updateStatus(id: string, status: SubscriptionStatus): Promise<void> {
    const { error } = await supabase
      .from('subscriptions')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async changePlan(id: string, planId: string): Promise<void> {
    const { error } = await supabase
      .from('subscriptions')
      .update({ plan_id: planId, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};
