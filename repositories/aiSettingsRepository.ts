import { supabase } from '@/services/supabase';
import type { AiSettings } from '@/types/ai';

const SETTINGS_COLUMNS =
  'model_selection,provider,default_model,qc_model,temperature,max_tokens,streaming,free_only_mode,mode,last_successful_model,last_successful_provider,created_at,updated_at';

// ai_settings is a global singleton (one row, id = true) — every workspace
// reads the same platform-wide config, so there's no workspace filter here.
export const aiSettingsRepository = {
  async get(): Promise<AiSettings | null> {
    const { data, error } = await supabase.from('ai_settings').select(SETTINGS_COLUMNS).maybeSingle();
    if (error) throw error;
    return data as AiSettings | null;
  },

  // Super-admin only in practice — RLS rejects the update otherwise.
  async update(patch: Partial<AiSettings>): Promise<AiSettings> {
    const { data, error } = await supabase
      .from('ai_settings')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', true)
      .select(SETTINGS_COLUMNS)
      .single();
    if (error) throw error;
    return data as AiSettings;
  },
};
