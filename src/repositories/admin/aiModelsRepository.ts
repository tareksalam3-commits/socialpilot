import { supabase } from '@/services/supabase';
import type { AiModelRow, AiProviderRow } from '@/types/database';

export type AiProviderWithModels = AiProviderRow & { models: AiModelRow[] };

export const aiModelsRepository = {
  async list(): Promise<AiProviderWithModels[]> {
    const { data, error } = await supabase
      .from('ai_providers')
      .select('*, ai_models(*)')
      .order('priority', { ascending: true });
    if (error) throw error;
    type Row = AiProviderRow & { ai_models: AiModelRow[] };
    return ((data ?? []) as unknown as Row[]).map((p) => ({ ...p, models: p.ai_models ?? [] }));
  },

  async toggleProvider(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('ai_providers')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async toggleModel(id: string, isActive: boolean): Promise<void> {
    const { error } = await supabase
      .from('ai_models')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async createModel(input: {
    provider_id: string;
    model_key: string;
    display_name: string;
    context_window: number;
    cost_per_1k_input: number;
    cost_per_1k_output: number;
    is_free: boolean;
  }): Promise<AiModelRow> {
    const { data, error } = await supabase.from('ai_models').insert(input).select().single();
    if (error) throw error;
    return data as AiModelRow;
  },

  async removeModel(id: string): Promise<void> {
    const { error } = await supabase.from('ai_models').delete().eq('id', id);
    if (error) throw error;
  },
};
