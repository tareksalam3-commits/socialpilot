import { useCallback, useEffect, useState } from 'react';
import { aiSettingsRepository } from '@/repositories/aiSettingsRepository';
import type { AiSettings } from '@/types/ai';

// ai_settings is a global singleton — every workspace reads the same
// platform-wide config (default model, temperature, manual/auto selection).
// `update` is only meaningful for super admins; RLS rejects it otherwise.
export function useAISettings() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await aiSettingsRepository.get();
      setSettings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load AI settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(async (patch: Partial<AiSettings>) => {
    try {
      const updated = await aiSettingsRepository.update(patch);
      setSettings(updated);
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update settings');
      throw e;
    }
  }, []);

  return { settings, loading, error, update, reload: load };
}
