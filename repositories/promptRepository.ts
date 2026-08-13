import { supabase } from '@/services/supabase';
import { escapePostgrestFilterValue } from '@/utils/postgrestFilter';
import type { Prompt, PromptFolder } from '@/types/ai';

export const promptFolderRepository = {
  async list(userId: string): Promise<PromptFolder[]> {
    const { data, error } = await supabase
      .from('prompt_folders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as PromptFolder[];
  },

  async create(input: { workspace_id: string; name: string; color?: string }): Promise<PromptFolder> {
    const { data, error } = await supabase
      .from('prompt_folders')
      .insert({ workspace_id: input.workspace_id, name: input.name, color: input.color ?? 'slate' })
      .select()
      .single();
    if (error) throw error;
    return data as PromptFolder;
  },

  async update(id: string, patch: Partial<PromptFolder>): Promise<void> {
    const { error } = await supabase.from('prompt_folders').update(patch).eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('prompt_folders').delete().eq('id', id);
    if (error) throw error;
  },
};

export const promptRepository = {
  async list(userId: string): Promise<Prompt[]> {
    const { data, error } = await supabase
      .from('prompts')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Prompt[];
  },

  async search(userId: string, query: string): Promise<Prompt[]> {
    const safe = escapePostgrestFilterValue(query);
    const { data, error } = await supabase
      .from('prompts')
      .select('*')
      .eq('user_id', userId)
      .or(`title.ilike.%${safe}%,content.ilike.%${safe}%,category.ilike.%${safe}%`)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Prompt[];
  },

  async create(input: {
    workspace_id: string;
    title: string;
    content: string;
    category?: string;
    variables?: string[];
    folder_id?: string | null;
  }): Promise<Prompt> {
    const { data, error } = await supabase
      .from('prompts')
      .insert({
        workspace_id: input.workspace_id,
        title: input.title,
        content: input.content,
        category: input.category ?? 'general',
        variables: input.variables ?? [],
        folder_id: input.folder_id ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Prompt;
  },

  async update(id: string, patch: Partial<Prompt>): Promise<Prompt> {
    const { data, error } = await supabase
      .from('prompts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Prompt;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('prompts').delete().eq('id', id);
    if (error) throw error;
  },

  async toggleFavorite(id: string, favorite: boolean): Promise<void> {
    const { error } = await supabase.from('prompts').update({ favorite }).eq('id', id);
    if (error) throw error;
  },
};
