import { supabase } from '@/services/supabase';
import { escapePostgrestFilterValue } from '@/utils/postgrestFilter';
import type { InboxAutomationRule, InboxConversation, InboxMessage, Notification } from '@/types/social';

export const inboxRepository = {
  async listConversations(workspaceId: string, filters?: { archived?: boolean }): Promise<InboxConversation[]> {
    let q = supabase.from('inbox_conversations').select('*').eq('workspace_id', workspaceId).order('updated_at', { ascending: false });
    if (filters?.archived !== undefined) q = q.eq('archived', filters.archived);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as InboxConversation[];
  },

  async search(workspaceId: string, query: string): Promise<InboxConversation[]> {
    const safe = escapePostgrestFilterValue(query);
    const { data, error } = await supabase
      .from('inbox_conversations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .or(`sender_name.ilike.%${safe}%,snippet.ilike.%${safe}%`)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as InboxConversation[];
  },

  async update(id: string, patch: Partial<InboxConversation>): Promise<void> {
    const { error } = await supabase.from('inbox_conversations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },

  async listMessages(conversationId: string): Promise<InboxMessage[]> {
    const { data, error } = await supabase
      .from('inbox_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as InboxMessage[];
  },

  // Actually sends the reply through the platform API (Meta Send/Comments
  // API, LinkedIn) via the `inbox-reply` edge function, then records the
  // outbound message — replaces the old direct-DB-write, which never
  // reached the platform at all. See supabase/functions/inbox-reply.
  async sendMessage(input: { conversation_id: string; content: string; is_ai?: boolean }): Promise<InboxMessage> {
    const { data, error } = await supabase.functions.invoke<{ message: InboxMessage }>('inbox-reply', {
      method: 'POST',
      body: { conversation_id: input.conversation_id, content: input.content, is_ai: input.is_ai ?? false },
    });
    if (error) throw error;
    if (!data?.message) throw new Error('Failed to send reply');
    return data.message;
  },
};

export const inboxAutomationRepository = {
  async list(workspaceId: string): Promise<InboxAutomationRule[]> {
    const { data, error } = await supabase
      .from('inbox_automation_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as InboxAutomationRule[];
  },

  async upsert(rule: Partial<InboxAutomationRule> & { workspace_id: string }): Promise<InboxAutomationRule> {
    const { data, error } = await supabase
      .from('inbox_automation_rules')
      .upsert({ ...rule, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (error) throw error;
    return data as InboxAutomationRule;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('inbox_automation_rules').delete().eq('id', id);
    if (error) throw error;
  },
};

export const notificationRepository = {
  async list(userId: string, limit = 50, offset = 0): Promise<Notification[]> {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data ?? []) as Notification[];
  },

  async create(input: {
    workspace_id: string;
    user_id: string;
    type: Notification['type'];
    title: string;
    message?: string;
    metadata?: Record<string, unknown>;
  }): Promise<Notification> {
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        workspace_id: input.workspace_id,
        user_id: input.user_id,
        type: input.type,
        title: input.title,
        message: input.message ?? null,
        metadata: input.metadata ?? {},
      })
      .select()
      .single();
    if (error) throw error;
    return data as Notification;
  },

  async markRead(id: string): Promise<void> {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
    if (error) throw error;
  },

  async markAllRead(userId: string): Promise<void> {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) throw error;
  },

  subscribe(userId: string, callback: (payload: { eventType: string; new: Notification; old: Notification }) => void) {
    // Scope the channel topic per user, and defensively remove any stale
    // channel left over from a previous mount (e.g. fast remounts/navigation
    // before the old channel's async removeChannel() finished). Without this,
    // supabase-js can hand back the old, already-subscribed channel instance
    // for the same topic, and calling `.on()` on it throws:
    // "cannot add `postgres_changes` callbacks ... after `subscribe` has been called".
    const topic = `notifications-${userId}`;
    const existing = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (existing) {
      supabase.removeChannel(existing);
    }
    return supabase
      .channel(topic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, callback as (payload: unknown) => void)
      .subscribe();
  },
};
