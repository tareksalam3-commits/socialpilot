import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { providerKeysRepository } from '@/repositories/providerKeysRepository';
import type { AiProvider, ProviderStatus } from '@/types/ai';

export function useProviderKeys() {
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace || !user) return;
    try {
      setLoading(true);
      setError(null);
      const data = await providerKeysRepository.listStatus(workspace.id, user.id);
      setStatuses(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load provider keys');
    } finally {
      setLoading(false);
    }
  }, [workspace, user]);

  useEffect(() => {
    load();
  }, [load]);

  const saveKey = useCallback(
    async (provider: AiProvider, apiKey: string) => {
      if (!workspace) return;
      await providerKeysRepository.saveKey(workspace.id, provider, apiKey);
      await load();
    },
    [workspace, load],
  );

  const clearKey = useCallback(
    async (provider: AiProvider) => {
      if (!workspace) return;
      await providerKeysRepository.clearKey(workspace.id, provider);
      await load();
    },
    [workspace, load],
  );

  const statusFor = useCallback((provider: AiProvider) => statuses.find((s) => s.provider === provider) ?? null, [statuses]);

  return { statuses, loading, error, saveKey, clearKey, statusFor, reload: load };
}
