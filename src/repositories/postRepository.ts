import { supabase } from '@/services/supabase';
import { escapePostgrestFilterValue } from '@/utils/postgrestFilter';
import type { Post, PostPlatformTarget, PostStatus } from '@/types/social';

export const postRepository = {
  async list(workspaceId: string, filters?: { status?: PostStatus; platform?: string }): Promise<Post[]> {
    let q = supabase.from('posts').select('*').eq('workspace_id', workspaceId).order('created_at', { ascending: false });
    if (filters?.status) q = q.eq('status', filters.status);
    if (filters?.platform) q = q.contains('platforms', [filters.platform]);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as Post[];
  },

  async search(workspaceId: string, query: string): Promise<Post[]> {
    const safe = escapePostgrestFilterValue(query);
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .or(`title.ilike.%${safe}%,content.ilike.%${safe}%`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Post[];
  },

  async get(id: string): Promise<Post | null> {
    const { data, error } = await supabase.from('posts').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data as Post | null;
  },

  async create(input: {
    workspace_id: string;
    title?: string;
    content: string;
    status?: PostStatus;
    platforms: string[];
    media_urls?: string[];
    scheduled_for?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<Post> {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('posts')
      .insert({
        workspace_id: input.workspace_id,
        user_id: userData.user!.id,
        title: input.title ?? null,
        content: input.content,
        status: input.status ?? 'draft',
        platforms: input.platforms,
        media_urls: input.media_urls ?? [],
        scheduled_for: input.scheduled_for ?? null,
        metadata: input.metadata ?? {},
      })
      .select()
      .single();
    if (error) throw error;
    return data as Post;
  },

  async update(id: string, patch: Partial<Post>): Promise<Post> {
    const { data, error } = await supabase
      .from('posts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Post;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('posts').delete().eq('id', id);
    if (error) throw error;
  },

  async duplicate(id: string): Promise<Post | null> {
    const original = await this.get(id);
    if (!original) return null;
    return this.create({
      workspace_id: original.workspace_id,
      title: `${original.title ?? 'Untitled'} (copy)`,
      content: original.content,
      status: 'draft',
      platforms: original.platforms,
      media_urls: original.media_urls,
    });
  },

  // Used by the Media Library's delete guard (see mediaRepository /
  // useMedia.remove): a media item whose URL still appears in any post's
  // `media_urls` — draft, scheduled, or published — must not be deletable,
  // since that would silently break that post's attached image. Checked
  // against the whole workspace, not just the current filtered list, so a
  // post the user isn't currently viewing still protects its media.
  async isMediaUrlInUse(workspaceId: string, url: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('posts')
      .select('id')
      .eq('workspace_id', workspaceId)
      .contains('media_urls', [url])
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  },

  async getTargets(postId: string): Promise<PostPlatformTarget[]> {
    const { data, error } = await supabase.from('post_platform_targets').select('*').eq('post_id', postId);
    if (error) throw error;
    return (data ?? []) as PostPlatformTarget[];
  },

  async createTarget(input: { post_id: string; platform: string; account_id?: string | null }): Promise<PostPlatformTarget> {
    const { data, error } = await supabase
      .from('post_platform_targets')
      .insert({ post_id: input.post_id, platform: input.platform, account_id: input.account_id ?? null })
      .select()
      .single();
    if (error) throw error;
    return data as PostPlatformTarget;
  },

  async updateTarget(id: string, patch: Partial<PostPlatformTarget>): Promise<void> {
    const { error } = await supabase.from('post_platform_targets').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
  },
};
