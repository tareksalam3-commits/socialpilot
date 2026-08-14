import { supabase } from '@/services/supabase';
import type { ApiKey } from '@/types/database';

export const apiKeyRepository = {
  async list(workspaceId: string): Promise<ApiKey[]> {
    const { data, error } = await supabase
      .from('api_keys')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ApiKey[];
  },

  async create(input: { workspace_id: string; label: string; masked_value: string }): Promise<ApiKey> {
    const { data, error } = await supabase
      .from('api_keys')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data as ApiKey;
  },

  async revoke(id: string): Promise<void> {
    const { error } = await supabase.from('api_keys').update({ status: 'revoked' }).eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('api_keys').delete().eq('id', id);
    if (error) throw error;
  },
};
