import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { accountRepository } from '@/repositories/accountRepository';
import type { ExtendedConnectedAccount } from '@/types/social';

export function useAccounts() {
  const { workspace } = useWorkspace();
  const [accounts, setAccounts] = useState<ExtendedConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setLoading(true);
      setError(null);
      const data = await accountRepository.list(workspace.id);
      setAccounts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  const disconnect = useCallback(async (id: string) => {
    try {
      await accountRepository.disconnect(id);
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'disconnected', health_status: 'unknown' } : a)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await accountRepository.remove(id);
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove account');
    }
  }, []);

  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const refreshToken = useCallback(async (id: string, platform: string) => {
    setRefreshingId(id);
    try {
      await accountRepository.refreshToken(id, platform);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh token');
      throw e;
    } finally {
      setRefreshingId(null);
    }
  }, [load]);

  const [syncingId, setSyncingId] = useState<string | null>(null);

  const syncAccount = useCallback(async (id: string) => {
    setSyncingId(id);
    try {
      await accountRepository.sync(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sync account');
      throw e;
    } finally {
      setSyncingId(null);
    }
  }, [load]);

  const [syncingAll, setSyncingAll] = useState(false);

  const syncAll = useCallback(async () => {
    if (!workspace) return;
    setSyncingAll(true);
    try {
      await accountRepository.syncAll(workspace.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to sync accounts');
      throw e;
    } finally {
      setSyncingAll(false);
    }
  }, [workspace, load]);

  return { accounts, loading, error, disconnect, remove, reload: load, refreshToken, refreshingId, syncAccount, syncingId, syncAll, syncingAll };
}
