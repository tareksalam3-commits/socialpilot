import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { postRepository } from '@/repositories/postRepository';
import { supabase } from '@/services/supabase';
import type { Post, PostStatus } from '@/types/social';

export function usePosts() {
  const { workspace } = useWorkspace();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<PostStatus | null>(null);
  const [filterPlatform, setFilterPlatform] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(
    async (signal?: { active: boolean }) => {
      if (!workspace) return;
      try {
        setLoading(true);
        setError(null);
        let data: Post[];
        if (searchQuery) {
          data = await postRepository.search(workspace.id, searchQuery);
        } else {
          data = await postRepository.list(workspace.id, { status: filterStatus ?? undefined, platform: filterPlatform ?? undefined });
        }
        if (!signal || signal.active) setPosts(data);
      } catch (e) {
        if (!signal || signal.active) setError(e instanceof Error ? e.message : 'Failed to load posts');
      } finally {
        if (!signal || signal.active) setLoading(false);
      }
    },
    [workspace, filterStatus, filterPlatform, searchQuery],
  );

  useEffect(() => {
    const signal = { active: true };
    // Debounce so typing in the search box doesn't fire a request per keystroke,
    // and guard against out-of-order responses overwriting fresher results.
    const handle = setTimeout(() => load(signal), searchQuery ? 300 : 0);
    return () => {
      signal.active = false;
      clearTimeout(handle);
    };
  }, [load, searchQuery]);

  // Live updates: the background scheduler (cron) publishes scheduled posts
  // and retries failed ones without any user action, so the list/calendar
  // needs to reflect that without a manual refresh.
  useEffect(() => {
    if (!workspace) return;
    const channel = supabase
      .channel(`posts-${workspace.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `workspace_id=eq.${workspace.id}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace, load]);

  const create = useCallback(
    async (input: { title?: string; content: string; platforms: string[]; scheduled_for?: string | null; media_urls?: string[]; status?: PostStatus }) => {
      if (!workspace) return null;
      try {
        const post = await postRepository.create({ workspace_id: workspace.id, ...input });
        setPosts((prev) => [post, ...prev]);
        return post;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create post');
        return null;
      }
    },
    [workspace],
  );

  const update = useCallback(async (id: string, patch: Partial<Post>) => {
    try {
      const updated = await postRepository.update(id, patch);
      setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update post');
      return null;
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await postRepository.remove(id);
      setPosts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete post');
    }
  }, []);

  const duplicate = useCallback(async (id: string) => {
    try {
      const copy = await postRepository.duplicate(id);
      if (copy) setPosts((prev) => [copy, ...prev]);
      return copy;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to duplicate post');
      return null;
    }
  }, []);

  return {
    posts,
    loading,
    error,
    create,
    update,
    remove,
    duplicate,
    filterStatus,
    setFilterStatus,
    filterPlatform,
    setFilterPlatform,
    searchQuery,
    setSearchQuery,
    reload: load,
  };
}
