import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { workspaceRepository } from '@/repositories/workspaceRepository';
import type { Workspace } from '@/types/database';

type WorkspaceState = {
  workspace: Workspace | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  ensureWorkspace: () => Promise<Workspace | null>;
};

export function useWorkspace(): WorkspaceState {
  const { user } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) {
      setWorkspace(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const ws = await workspaceRepository.getByOwner(user.id);
      setWorkspace(ws);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ensureWorkspace = useCallback(async (): Promise<Workspace | null> => {
    if (!user) return null;
    try {
      let ws = await workspaceRepository.getByOwner(user.id);
      if (!ws) {
        ws = await workspaceRepository.create({
          name: user.email?.split('@')[0] ?? 'My Workspace',
          brand_name: user.email?.split('@')[0] ?? null,
        });
      }
      setWorkspace(ws);
      return ws;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create workspace');
      return null;
    }
  }, [user]);

  return { workspace, loading, error, refresh, ensureWorkspace };
}
