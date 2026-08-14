import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { postRepository } from '@/repositories/postRepository';
import { supabase } from '@/services/supabase';
import { validateFinalPostContent } from '@/engines/aiOrchestrator';
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
    async (input: {
      title?: string;
      content: string;
      platforms: string[];
      scheduled_for?: string | null;
      media_urls?: string[];
      status?: PostStatus;
      metadata?: Record<string, unknown>;
    }) => {
      if (!workspace) return null;
      // Final Quality Check gate — the same validateFinalPostContent() gate
      // every other authoring surface (AI Assistant, Content Sources) must
      // clear before a post can reach status 'scheduled'. A manually
      // written/pasted post is never exempt: Quality FAIL blocks
      // scheduling, with no override. Draft saves are unaffected — the
      // gate only applies when the post is actually being scheduled.
      if (input.status === 'scheduled') {
        const check = validateFinalPostContent(input.content);
        if (!check.valid) return null;
      }
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

  const update = useCallback(
    async (id: string, patch: Partial<Post>) => {
      // Final Quality Check gate — same as create() above. Applies to every
      // path that flips a post to 'scheduled': the editor, drag-to-
      // reschedule on the Calendar, and the reschedule dialog all funnel
      // through this one update() function, so none of them can bypass it.
      // There is no override: Quality FAIL blocks scheduling. Content isn't
      // always part of the patch (e.g. a pure reschedule), so the check
      // runs against the post's current stored content when the patch
      // itself doesn't change it. Callers that want the specific failure
      // reasons (to show the user what to fix) should run
      // validateFinalPostContent() themselves before calling update() with
      // the content they're about to save, same as the editor does.
      if (patch.status === 'scheduled') {
        const existing = posts.find((p) => p.id === id);
        const contentToCheck = patch.content ?? existing?.content ?? '';
        const check = validateFinalPostContent(contentToCheck);
        if (!check.valid) return null;
      }

      // Manual Edit Protection (Phase 2, section 23) — a manual content
      // edit to a post the AI Assistant previously marked `approved: true`
      // invalidates that approval: it was reviewed against a version of
      // the text that no longer exists. Flip it back to
      // approved: false / needs_review: true so the post re-enters
      // Quality Review instead of silently keeping a stale "approved"
      // badge. Only triggers when content actually changes and the post
      // was actually assistant-approved — untouched by pure reschedules,
      // manually-authored posts (no `assistant` metadata to begin with),
      // or posts already pending review.
      let patchWithReview = patch;
      const existingForReview = posts.find((p) => p.id === id);
      const assistantMeta = existingForReview?.metadata?.assistant as { approved?: boolean } | undefined;
      const workflowMeta = (existingForReview?.metadata?.content_workflow ?? {}) as Record<string, unknown>;
      const contentChanged =
        typeof patch.content === 'string' &&
        !!existingForReview &&
        patch.content !== existingForReview.content;
      if (contentChanged && existingForReview) {
        patchWithReview = {
          ...patch,
          metadata: {
            ...existingForReview.metadata,
            ...patch.metadata,
            content_workflow: {
              ...workflowMeta,
              stage: 'editing',
              quality_status: 'in_review',
              needs_review: true,
              updated_at: new Date().toISOString(),
            },
            ...(assistantMeta?.approved === true
              ? {
                  assistant: {
                    ...assistantMeta,
                    ...(patch.metadata?.assistant as Record<string, unknown> | undefined),
                    approved: false,
                    needs_review: true,
                  },
                }
              : {}),
          },
        };
      }

      try {
        const updated = await postRepository.update(id, patchWithReview);
        setPosts((prev) => prev.map((p) => (p.id === id ? updated : p)));
        return updated;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update post');
        return null;
      }
    },
    [posts],
  );

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
