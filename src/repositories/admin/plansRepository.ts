import { supabase } from '@/services/supabase';
import type { SubscriptionPlan } from '@/types/database';

export type PlanInput = Omit<SubscriptionPlan, 'id' | 'created_at' | 'updated_at'>;

export const plansRepository = {
  async list(): Promise<SubscriptionPlan[]> {
    const { data, error } = await supabase.from('subscription_plans').select('*').order('sort_order', { ascending: true });
    if (error) throw error;
    return (data ?? []) as SubscriptionPlan[];
  },

  async create(input: Partial<PlanInput> & { name: string; slug: string }): Promise<SubscriptionPlan> {
    const { data, error } = await supabase.from('subscription_plans').insert(input).select().single();
    if (error) throw error;
    return data as SubscriptionPlan;
  },

  async update(id: string, patch: Partial<PlanInput>): Promise<SubscriptionPlan> {
    const { data, error } = await supabase
      .from('subscription_plans')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as SubscriptionPlan;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('subscription_plans').delete().eq('id', id);
    if (error) throw error;
  },
};
