import { supabase } from '@/services/supabase';
import type { ContentSource, ContentSourceType } from '@/types/contentSources';

const FILE_TYPES: ContentSourceType[] = ['pdf', 'word', 'excel'];

export const contentSourceRepository = {
  async list(workspaceId: string): Promise<ContentSource[]> {
    const { data, error } = await supabase
      .from('content_sources')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ContentSource[];
  },

  async createLink(input: { workspace_id: string; type: ContentSourceType; source_url: string; name?: string | null }): Promise<ContentSource> {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('content_sources')
      .insert({
        workspace_id: input.workspace_id,
        user_id: userData.user!.id,
        type: input.type,
        source_url: input.source_url,
        name: input.name ?? null,
      })
      .select()
      .single();
    if (error) throw error;
    return data as ContentSource;
  },

  // Uploads the document to the private `content-sources` bucket under
  // `{workspace_id}/{user_id}/...` (required by the storage RLS policies),
  // then creates the matching content_sources row pointing at it.
  async createFile(input: { workspace_id: string; type: Extract<ContentSourceType, 'pdf' | 'word' | 'excel'>; file: File }): Promise<ContentSource> {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user!.id;
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const safeName = input.file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${input.workspace_id}/${userId}/${unique}-${safeName}`;

    const { error: uploadError } = await supabase.storage.from('content-sources').upload(path, input.file);
    if (uploadError) throw uploadError;

    const { data, error } = await supabase
      .from('content_sources')
      .insert({
        workspace_id: input.workspace_id,
        user_id: userId,
        type: input.type,
        file_path: path,
        name: input.file.name,
      })
      .select()
      .single();
    if (error) {
      // Roll back the uploaded file if the row insert failed (e.g. the
      // 10-source limit trigger fired) so we don't leak orphaned storage objects.
      await supabase.storage.from('content-sources').remove([path]);
      throw error;
    }
    return data as ContentSource;
  },

  async remove(source: ContentSource): Promise<void> {
    const { error } = await supabase.from('content_sources').delete().eq('id', source.id);
    if (error) throw error;
    if (source.file_path && FILE_TYPES.includes(source.type)) {
      await supabase.storage.from('content-sources').remove([source.file_path]);
    }
  },

  async updateLastProcessedHash(id: string, hash: string): Promise<void> {
    const { error } = await supabase.from('content_sources').update({ last_processed_hash: hash }).eq('id', id);
    if (error) throw error;
  },
};
