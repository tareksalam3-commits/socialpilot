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
    const { error } = await supabase.from('ai_provider_keys').upsert(
      {
        workspace_id: workspaceId,
        provider,
        api_key_encrypted: apiKey,
        base_url: extra?.baseUrl ?? null,
        account_id: extra?.accountId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,provider' },
    );
    if (error) throw error;
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
