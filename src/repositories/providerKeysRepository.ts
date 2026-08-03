import { supabase } from '@/services/supabase';
import type { AiProvider, ProviderStatus } from '@/types/ai';

export const providerKeysRepository = {
  async listStatus(workspaceId: string, callerId: string): Promise<ProviderStatus[]> {
    const { data, error } = await supabase.rpc('list_ai_provider_status', {
      p_workspace_id: workspaceId,
      p_caller_id: callerId,
    });
    if (error) throw error;
    return (data ?? []) as ProviderStatus[];
  },

  async saveKey(
    workspaceId: string,
    provider: AiProvider,
    apiKey: string,
    extra?: { baseUrl?: string | null; accountId?: string | null },
  ): Promise<void> {
    // Every workspace already has a row for every supported provider (seeded on
    // workspace creation), so a plain UPDATE is enough — and unlike an upsert with
    // ON CONFLICT, it doesn't require table-level SELECT privilege on this table,
    // which is intentionally not granted so the raw key can never be read back.
    const { error, count } = await supabase
      .from('ai_provider_keys')
      .update(
        {
          api_key_encrypted: apiKey,
          base_url: extra?.baseUrl ?? null,
          account_id: extra?.accountId ?? null,
          updated_at: new Date().toISOString(),
        },
        { count: 'exact' },
      )
      .eq('workspace_id', workspaceId)
      .eq('provider', provider);
    if (error) throw error;
    if (!count) {
      // Defensive fallback in case the row is somehow missing (e.g. a workspace
      // created before the seeding trigger existed).
      const { error: insertError } = await supabase.from('ai_provider_keys').insert({
        workspace_id: workspaceId,
        provider,
        api_key_encrypted: apiKey,
        base_url: extra?.baseUrl ?? null,
        account_id: extra?.accountId ?? null,
      });
      if (insertError) throw insertError;
    }
  },

  async clearKey(workspaceId: string, provider: AiProvider): Promise<void> {
    const { error } = await supabase
      .from('ai_provider_keys')
      .update({ api_key_encrypted: null, last_test_status: null, last_tested_at: null, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('provider', provider);
    if (error) throw error;
  },
};
