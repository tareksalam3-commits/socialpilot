import { supabase } from '@/services/supabase';
import type { AdminUserRow, PlatformRole } from '@/types/database';

export const adminUsersRepository = {
  async list(page = 1, perPage = 100): Promise<{ users: AdminUserRow[]; total: number }> {
    const { data, error } = await supabase.functions.invoke<{ users: AdminUserRow[]; total: number }>(
      `admin-users?page=${page}&perPage=${perPage}`,
      { method: 'GET' },
    );
    if (error) throw error;
    return { users: data?.users ?? [], total: data?.total ?? 0 };
  },

  async setPlatformRole(userId: string, role: PlatformRole): Promise<void> {
    const { error } = await supabase.functions.invoke('admin-users', {
      method: 'POST',
      body: { action: 'set_platform_role', userId, role },
    });
    if (error) throw error;
  },

  async setBanned(userId: string, banned: boolean): Promise<void> {
    const { error } = await supabase.functions.invoke('admin-users', {
      method: 'POST',
      body: { action: banned ? 'ban' : 'unban', userId },
    });
    if (error) throw error;
  },
};
