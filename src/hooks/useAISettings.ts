import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { aiSettingsRepository } from '@/repositories/aiSettingsRepository';
import type { AiSettings } from '@/types/ai';

export function useAISettings() {
  const { workspace } = useWorkspace();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setLoading(true);
      setError(null);
      const data = await aiSettingsRepository.get(workspace.id);
      setSettings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load AI settings');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    async (patch: Partial<AiSettings>) => {
      if (!workspace) return;
      try {
        const updated = await aiSettingsRepository.update(workspace.id, patch);
        setSettings(updated);
        return updated;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update settings');
        throw e;
      }
    },
    [workspace],
  );

  const setApiKey = useCallback(
    async (apiKey: string) => {
      if (!workspace) return;
      try {
        await aiSettingsRepository.setApiKey(workspace.id, apiKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save API key');
        throw e;
      }
    },
    [workspace],
  );

  return { settings, loading, error, update, setApiKey, reload: load };
}
