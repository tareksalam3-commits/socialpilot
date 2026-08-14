import { supabase } from '@/services/supabase';
import type { Conversation, Message, ChatRole } from '@/types/ai';

export const conversationRepository = {
  async list(userId: string): Promise<Conversation[]> {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Conversation[];
  },

  async search(userId: string, query: string): Promise<Conversation[]> {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('user_id', userId)
      .ilike('title', `%${query}%`)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Conversation[];
  },

  async create(input: { workspace_id: string; title?: string; model?: string }): Promise<Conversation> {
    const { data, error } = await supabase
      .from('conversations')
      .insert({
        workspace_id: input.workspace_id,
        title: input.title ?? 'New Conversation',
        model: input.model ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Conversation;
  },

  async update(id: string, patch: Partial<Conversation>): Promise<Conversation> {
    const { data, error } = await supabase
      .from('conversations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Conversation;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('conversations').delete().eq('id', id);
    if (error) throw error;
  },

  async toggleFavorite(id: string, favorite: boolean): Promise<void> {
    const { error } = await supabase.from('conversations').update({ favorite }).eq('id', id);
    if (error) throw error;
  },
};

export const messageRepository = {
  async list(conversationId: string): Promise<Message[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Message[];
  },

  async create(input: {
    conversation_id: string;
    role: ChatRole;
    content: string;
    model?: string;
    tokens?: number;
    response_time_ms?: number;
    cost_estimate?: number;
  }): Promise<Message> {
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: input.conversation_id,
        role: input.role,
        content: input.content,
        model: input.model ?? null,
        tokens: input.tokens ?? 0,
        response_time_ms: input.response_time_ms ?? null,
        cost_estimate: input.cost_estimate ?? 0,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Message;
  },

  async update(id: string, patch: Partial<Message>): Promise<void> {
    const { error } = await supabase.from('messages').update(patch).eq('id', id);
    if (error) throw error;
  },

  async toggleFavorite(id: string, favorite: boolean): Promise<void> {
    const { error } = await supabase.from('messages').update({ favorite }).eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('messages').delete().eq('id', id);
    if (error) throw error;
  },
};
