import { useCallback, useEffect, useState } from 'react';
import { providerKeysRepository } from '@/repositories/providerKeysRepository';
import type { AiProvider, ProviderStatus } from '@/types/ai';

// ai_provider_keys is a global pool of keys — super-admin only (RLS blocks
// everyone else from writing, and there's no SELECT policy at all, so
// listStatus() is the only way to check configuration state).
export function useProviderKeys() {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await providerKeysRepository.listStatus();
      setStatuses(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load provider keys');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveKey = useCallback(
    async (provider: AiProvider, apiKey: string) => {
      await providerKeysRepository.saveKey(provider, apiKey);
      await load();
    },
    [load],
  );

  const clearKey = useCallback(
    async (provider: AiProvider) => {
      await providerKeysRepository.clearKey(provider);
      await load();
    },
    [load],
  );

  const statusFor = useCallback((provider: AiProvider) => statuses.find((s) => s.provider === provider) ?? null, [statuses]);

  return { statuses, loading, error, saveKey, clearKey, statusFor, reload: load };
}
