import { supabase } from '@/services/supabase';
import type { Payment } from '@/types/database';

export type AdminPaymentRow = Payment & { workspace_name: string };

export const paymentsRepository = {
  async list(): Promise<AdminPaymentRow[]> {
    const { data, error } = await supabase
      .from('payments')
      .select('*, workspaces(name)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    type Row = Payment & { workspaces: { name: string } | null };
    return ((data ?? []) as unknown as Row[]).map((p) => ({ ...p, workspace_name: p.workspaces?.name ?? '—' }));
  },
};
