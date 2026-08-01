import { supabase } from '@/services/supabase';
import type { AiSettings } from '@/types/ai';

export const aiSettingsRepository = {
  async get(workspaceId: string): Promise<AiSettings | null> {
    const { data, error } = await supabase
      .from('ai_settings')
      .select('id,workspace_id,provider,default_model,temperature,max_tokens,streaming,free_only_mode,mode,last_successful_model,created_at,updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data as AiSettings | null;
  },

  async update(workspaceId: string, patch: Partial<AiSettings>): Promise<AiSettings> {
    const { data, error } = await supabase
      .from('ai_settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .select('id,workspace_id,provider,default_model,temperature,max_tokens,streaming,free_only_mode,mode,last_successful_model,created_at,updated_at')
      .single();
    if (error) throw error;
    return data as AiSettings;
  },

  async setApiKey(workspaceId: string, apiKey: string): Promise<void> {
    const { error } = await supabase
      .from('ai_settings')
      .update({ api_key_encrypted: apiKey, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    if (error) throw error;
  },
};
