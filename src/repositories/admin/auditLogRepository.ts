import { supabase } from '@/services/supabase';
import type { AuditLog } from '@/types/database';

export const auditLogRepository = {
  async list(limit = 100): Promise<AuditLog[]> {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AuditLog[];
  },

  async log(action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from('audit_logs').insert({
      actor_id: userData.user?.id,
      actor_email: userData.user?.email,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      metadata: metadata ?? {},
    });
  },
};
