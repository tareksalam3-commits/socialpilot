import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { audienceProfileRepository } from '@/repositories/audienceProfileRepository';
import type { AudienceProfile } from '@/types/ai';

// Phase 2, STEP 4 (Audience Intelligence) + STEP 14 (UI Integration).
// Mirrors useBrandVoice.ts exactly — same one-row-per-workspace shape,
// same seeded-on-creation guarantee, same load/update contract.
export function useAudienceProfile() {
  const { workspace } = useWorkspace();
  const [audienceProfile, setAudienceProfile] = useState<AudienceProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const data = await audienceProfileRepository.get(workspace.id);
      setAudienceProfile(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audience profile');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    async (patch: Partial<AudienceProfile>) => {
      if (!workspace) return;
      try {
        const updated = await audienceProfileRepository.update(workspace.id, patch);
        setAudienceProfile(updated);
        return updated;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update audience profile');
        throw e;
      }
    },
    [workspace],
  );

  return { audienceProfile, loading, error, update, reload: load };
}
