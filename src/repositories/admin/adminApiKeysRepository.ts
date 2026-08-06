import { supabase } from '@/services/supabase';

export type PlatformKeyName = 'openai_api_key' | 'anthropic_api_key' | 'openrouter_api_key' | 'google_ai_api_key';
export type PlatformKeyStatus = { configured: boolean; masked: string | null };

export const adminApiKeysRepository = {
  async list(): Promise<Record<PlatformKeyName, PlatformKeyStatus>> {
    const { data, error } = await supabase.functions.invoke<{ keys: Record<PlatformKeyName, PlatformKeyStatus> }>(
      'admin-secrets',
      { method: 'GET' },
    );
    if (error) throw error;
    return data!.keys;
  },

  async save(values: Partial<Record<PlatformKeyName, string>>): Promise<void> {
    const { data, error } = await supabase.functions.invoke<{ saved: string[] }>('admin-secrets', {
      method: 'POST',
      body: values,
    });
    if (error || !data?.saved?.length) throw new Error(error?.message ?? 'Could not save keys');
  },

  async remove(key: PlatformKeyName): Promise<void> {
    const { error } = await supabase.functions.invoke('admin-secrets', { method: 'DELETE', body: { key } });
    if (error) throw error;
  },
};
