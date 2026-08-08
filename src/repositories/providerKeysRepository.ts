import { supabase } from '@/services/supabase';
import type { AiProvider, ProviderStatus } from '@/types/ai';

// ai_provider_keys is a global pool of keys (one row per provider), managed
// by super admins only — see list_ai_provider_status() and the RLS policies
// on this table. There's no workspace filter here.
export const providerKeysRepository = {
  async listStatus(): Promise<ProviderStatus[]> {
    const { data, error } = await supabase.rpc('list_ai_provider_status');
    if (error) throw error;
    return (data ?? []) as ProviderStatus[];
  },

  async saveKey(provider: AiProvider, apiKey: string, extra?: { baseUrl?: string | null; accountId?: string | null }): Promise<void> {
    // Every provider already has a row (seeded once when the table was
    // globalized), so a plain UPDATE is enough. We rely solely on `error`
    // here — the `count: 'exact'` fallback this used to have was unreliable
    // (the update could succeed with a 204 yet report a falsy count), which
    // triggered a bogus INSERT fallback that collided with the existing row
    // and surfaced as a false "save failed" even though the key had already
    // been saved.
    const { error } = await supabase
      .from('ai_provider_keys')
      .update({
        api_key_encrypted: apiKey,
        base_url: extra?.baseUrl ?? null,
        account_id: extra?.accountId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider', provider);
    if (error) throw error;
  },

  async clearKey(provider: AiProvider): Promise<void> {
    const { error } = await supabase
      .from('ai_provider_keys')
      .update({ api_key_encrypted: null, last_test_status: null, last_tested_at: null, updated_at: new Date().toISOString() })
      .eq('provider', provider);
    if (error) throw error;
  },
};
