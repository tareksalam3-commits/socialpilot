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

  return { accounts, loading, error, disconnect, remove, reload: load };
}
