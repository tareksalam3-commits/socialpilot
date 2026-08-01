import { supabase } from '@/services/supabase';
import { escapePostgrestFilterValue } from '@/utils/postgrestFilter';
import type { MediaItem, MediaFolder } from '@/types/social';

export const mediaFolderRepository = {
  async list(workspaceId: string): Promise<MediaFolder[]> {
    const { data, error } = await supabase
      .from('media_folders')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as MediaFolder[];
  },

  async create(input: { workspace_id: string; name: string }): Promise<MediaFolder> {
    const { data, error } = await supabase
      .from('media_folders')
      .insert({ workspace_id: input.workspace_id, name: input.name })
      .select()
      .single();
    if (error) throw error;
    return data as MediaFolder;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('media_folders').delete().eq('id', id);
    if (error) throw error;
  },
};

export const mediaRepository = {
  async list(workspaceId: string, filters?: { type?: string; folder_id?: string | null }): Promise<MediaItem[]> {
    let q = supabase.from('media_items').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
    if (filters?.type) q = q.eq('type', filters.type);
    if (filters?.folder_id !== undefined) q = q.eq('folder_id', filters.folder_id);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as MediaItem[];
  },

  async search(workspaceId: string, query: string): Promise<MediaItem[]> {
    const { data, error } = await supabase
      .from('media_items')
      .select('*')
      .eq('workspace_id', workspaceId)
      .or(`name.ilike.%${escapePostgrestFilterValue(query)}%,tags.cs.{${query.replace(/[{}",]/g, '')}}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as MediaItem[];
  },

  async create(input: {
    workspace_id: string;
    name: string;
    type: 'image' | 'video' | 'document';
    url: string;
    thumbnail_url?: string | null;
    size_bytes?: number | null;
    mime_type?: string | null;
    tags?: string[];
    folder_id?: string | null;
  }): Promise<MediaItem> {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('media_items')
      .insert({
        workspace_id: input.workspace_id,
        user_id: userData.user!.id,
        name: input.name,
        type: input.type,
        url: input.url,
        thumbnail_url: input.thumbnail_url ?? null,
        size_bytes: input.size_bytes ?? null,
        mime_type: input.mime_type ?? null,
        tags: input.tags ?? [],
        folder_id: input.folder_id ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as MediaItem;
  },

  async update(id: string, patch: Partial<MediaItem>): Promise<void> {
    const { error } = await supabase.from('media_items').update(patch).eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('media_items').delete().eq('id', id);
    if (error) throw error;
  },

  async upload(file: File, workspaceId: string): Promise<string> {
    const { data: userData } = await supabase.auth.getUser();
    const ext = file.name.split('.').pop();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = `${workspaceId}/${userData.user!.id}/${unique}.${ext}`;
    const { error } = await supabase.storage.from('media').upload(path, file);
    if (error) throw error;
    const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
    return urlData.publicUrl;
  },
};
