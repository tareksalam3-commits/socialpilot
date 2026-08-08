import { supabase } from '@/services/supabase';
import type { AiUsage } from '@/types/database';

export type AdminAiCreditRow = AiUsage & { workspace_name: string };

export const aiCreditsRepository = {
  async list(): Promise<AdminAiCreditRow[]> {
    const { data, error } = await supabase
      .from('ai_usage')
      .select('*, workspaces(name)')
      .order('credits_used', { ascending: false });
    if (error) throw error;
    type Row = AiUsage & { workspaces: { name: string } | null };
    return ((data ?? []) as unknown as Row[]).map((u) => ({ ...u, workspace_name: u.workspaces?.name ?? '—' }));
  },

  async setLimit(id: string, creditsLimit: number): Promise<void> {
    const { error } = await supabase
      .from('ai_usage')
      .update({ credits_limit: creditsLimit, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async resetUsage(id: string): Promise<void> {
    const { error } = await supabase
      .from('ai_usage')
      .update({ credits_used: 0, period_start: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};
