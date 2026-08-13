import { useCallback, useEffect, useState } from 'react';
import { providerKeysRepository } from '@/repositories/providerKeysRepository';
import type { AiProvider, ProviderDailyUsage, ProviderStatus } from '@/types/ai';

// ai_provider_keys is a global pool of keys — super-admin only (RLS blocks
// everyone else from writing, and there's no SELECT policy at all, so
// listStatus() is the only way to check configuration state).
export function useProviderKeys() {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [dailyUsage, setDailyUsage] = useState<ProviderDailyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Both are super-admin-gated RPCs; a non-super-admin caller just gets
      // empty results back (not an error), so it's safe to run together.
      const [statusData, usageData] = await Promise.all([providerKeysRepository.listStatus(), providerKeysRepository.getDailyUsage()]);
      setStatuses(statusData);
      setDailyUsage(usageData);
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
  const usageFor = useCallback(
    (provider: AiProvider) => dailyUsage.find((u) => u.provider === provider) ?? { provider, requests_today: 0, failed_today: 0 },
    [dailyUsage],
  );

  return { statuses, dailyUsage, loading, error, saveKey, clearKey, statusFor, usageFor, reload: load };
}
