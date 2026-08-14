import { supabase } from '@/services/supabase';
import type { SystemSetting } from '@/types/database';

export const systemSettingsRepository = {
  async list(): Promise<SystemSetting[]> {
    const { data, error } = await supabase.from('system_settings').select('*').order('key', { ascending: true });
    if (error) throw error;
    return (data ?? []) as SystemSetting[];
  },

  async set(key: string, value: unknown): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key, value, updated_by: userData.user?.id, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
  },
};
