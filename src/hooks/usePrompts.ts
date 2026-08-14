import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { promptRepository, promptFolderRepository } from '@/repositories/promptRepository';
import type { Prompt, PromptFolder } from '@/types/ai';

export function usePrompts() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [folders, setFolders] = useState<PromptFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const [p, f] = await Promise.all([
        promptRepository.list(user.id),
        promptFolderRepository.list(user.id),
      ]);
      setPrompts(p);
      setFolders(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load prompts');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const createPrompt = useCallback(
    async (input: { title: string; content: string; category?: string; variables?: string[]; folder_id?: string | null }) => {
      if (!user || !workspace) return null;
      try {
        const p = await promptRepository.create({ workspace_id: workspace.id, ...input });
        setPrompts((prev) => [p, ...prev]);
        return p;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create prompt');
        return null;
      }
    },
    [user, workspace],
  );

  const updatePrompt = useCallback(async (id: string, patch: Partial<Prompt>) => {
    try {
      const updated = await promptRepository.update(id, patch);
      setPrompts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update prompt');
      return null;
    }
  }, []);

  const deletePrompt = useCallback(async (id: string) => {
    try {
      await promptRepository.remove(id);
      setPrompts((prev) => prev.filter((p) => p.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete prompt');
    }
  }, []);

  const toggleFavorite = useCallback(async (id: string, favorite: boolean) => {
    try {
      await promptRepository.toggleFavorite(id, favorite);
      setPrompts((prev) => prev.map((p) => (p.id === id ? { ...p, favorite } : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle favorite');
    }
  }, []);

  const search = useCallback(
    async (query: string) => {
      if (!user || !query.trim()) {
        load();
        return;
      }
      try {
        const results = await promptRepository.search(user.id, query);
        setPrompts(results);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
      }
    },
    [user, load],
  );

  const createFolder = useCallback(
    async (name: string, color?: string) => {
      if (!user || !workspace) return null;
      try {
        const f = await promptFolderRepository.create({ workspace_id: workspace.id, name, color });
        setFolders((prev) => [...prev, f]);
        return f;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create folder');
        return null;
      }
    },
    [user, workspace],
  );

  const deleteFolder = useCallback(async (id: string) => {
    try {
      await promptFolderRepository.remove(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete folder');
    }
  }, []);

  return {
    prompts,
    folders,
    loading,
    error,
    createPrompt,
    updatePrompt,
    deletePrompt,
    toggleFavorite,
    search,
    createFolder,
    deleteFolder,
    reload: load,
  };
}
