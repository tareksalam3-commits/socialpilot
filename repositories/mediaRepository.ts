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

// Public Storage URLs look like
// `${SUPABASE_URL}/storage/v1/object/public/media/<workspace>/<user>/<file>`.
// mediaRepository.upload() (below) is the only place that builds these URLs,
// so reversing the same shape here is safe — anything that doesn't match
// (e.g. an external URL a caller stored directly) is left alone rather than
// guessed at.
function storagePathFromPublicUrl(url: string): string | null {
  const marker = '/object/public/media/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split('?')[0];
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export const mediaRepository = {
  async list(workspaceId: string, filters?: { type?: string; folder_id?: string | null; search?: string }): Promise<MediaItem[]> {
    let q = supabase.from('media_items').select('*').eq('workspace_id', workspaceId);
    if (filters?.type) q = q.eq('type', filters.type);
    if (filters?.folder_id !== undefined) q = q.eq('folder_id', filters.folder_id);
    // Folder/type filters and the search query are applied to the SAME
    // query (AND'd together via chained .eq()/.or()), not run as separate
    // fetches — so "Folder = Marketing" + "Search = campaign" correctly
    // returns only Marketing items matching "campaign", instead of the
    // search wiping out the folder/type filters (see useMedia.ts, which
    // used to call this and search() as two mutually-exclusive branches).
    if (filters?.search) {
      const query = filters.search;
      q = q.or(`name.ilike.%${escapePostgrestFilterValue(query)}%,tags.cs.{${query.replace(/[{}",]/g, '')}}`);
    }
    const { data, error } = await q.order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as MediaItem[];
  },

  // Thin wrapper kept for any external caller that only needs a plain text
  // search with no folder/type filtering (e.g. GlobalSearchPage). Internal
  // callers that also have active filters should call list() directly so
  // the filters are combined into one query instead of two separate ones.
  async search(workspaceId: string, query: string): Promise<MediaItem[]> {
    return mediaRepository.list(workspaceId, { search: query });
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

  // Deletes both the underlying Storage object AND the `media_items` row.
  // Storage is deleted FIRST and its error is NOT swallowed: if the Storage
  // delete fails, this throws immediately and the DB row is left intact —
  // so the item stays visible in the library (with its file still present)
  // instead of the operation being reported as a success while an orphaned
  // file lingers in the `media` bucket. Only once Storage confirms deletion
  // (or there's no resolvable Storage path, e.g. an externally-hosted URL)
  // does the DB row get deleted. Callers that need to protect media still
  // referenced by a post must check that BEFORE calling remove() (see
  // postRepository.isMediaUrlInUse / useMedia.remove).
  async remove(id: string): Promise<void> {
    const { data: item, error: fetchError } = await supabase.from('media_items').select('url').eq('id', id).maybeSingle();
    if (fetchError) throw fetchError;
    const path = item?.url ? storagePathFromPublicUrl(item.url) : null;
    if (path) {
      const { error: storageError } = await supabase.storage.from('media').remove([path]);
      if (storageError) throw storageError;
    }
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
