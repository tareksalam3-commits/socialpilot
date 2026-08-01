import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { brandVoiceRepository } from '@/repositories/brandVoiceRepository';
import type { BrandVoice } from '@/types/ai';

export function useBrandVoice() {
  const { workspace } = useWorkspace();
  const [brandVoice, setBrandVoice] = useState<BrandVoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setLoading(true);
      setError(null);
      const data = await brandVoiceRepository.get(workspace.id);
      setBrandVoice(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load brand voice');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    async (patch: Partial<BrandVoice>) => {
      if (!workspace) return;
      try {
        const updated = await brandVoiceRepository.update(workspace.id, patch);
        setBrandVoice(updated);
        return updated;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update brand voice');
        throw e;
      }
    },
    [workspace],
  );

  return { brandVoice, loading, error, update, reload: load };
}
