import { supabase } from '@/services/supabase';
import type { Workspace } from '@/types/database';

export type AdminWorkspaceRow = Workspace & {
  member_count: number;
  owner_email: string | null;
  subscription_status: string | null;
  plan_name: string | null;
};

export const adminWorkspacesRepository = {
  async list(): Promise<AdminWorkspaceRow[]> {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*, workspace_members(count), subscriptions(status, subscription_plans(name))')
      .order('created_at', { ascending: false });
    if (error) throw error;
    type Row = Workspace & {
      workspace_members: { count: number }[];
      subscriptions: { status: string; subscription_plans: { name: string } | null }[] | { status: string; subscription_plans: { name: string } | null } | null;
    };
    return ((data ?? []) as unknown as Row[]).map((w) => {
      const sub = Array.isArray(w.subscriptions) ? w.subscriptions[0] : w.subscriptions;
      return {
        ...w,
        member_count: w.workspace_members?.[0]?.count ?? 0,
        owner_email: null,
        subscription_status: sub?.status ?? null,
        plan_name: sub?.subscription_plans?.name ?? null,
      };
    });
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('workspaces').delete().eq('id', id);
    if (error) throw error;
  },
};
