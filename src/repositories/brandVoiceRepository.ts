import { supabase } from '@/services/supabase';
import type { BrandVoice } from '@/types/ai';

export const brandVoiceRepository = {
  async get(workspaceId: string): Promise<BrandVoice | null> {
    const { data, error } = await supabase
      .from('brand_voice')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data as BrandVoice | null;
  },

  async update(workspaceId: string, patch: Partial<BrandVoice>): Promise<BrandVoice> {
    const { data, error } = await supabase
      .from('brand_voice')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .select()
      .single();
    if (error) throw error;
    return data as BrandVoice;
  },
};
