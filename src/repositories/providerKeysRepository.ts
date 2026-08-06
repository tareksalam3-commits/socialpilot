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
    // globalized), so a plain UPDATE is enough — and unlike an upsert with
    // ON CONFLICT, it doesn't require table-level SELECT privilege on this
    // table, which is intentionally not granted so the raw key can never be
    // read back.
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
      .eq('provider', provider);
    if (error) throw error;
    if (!count) {
      // Defensive fallback in case the row is somehow missing.
      const { error: insertError } = await supabase.from('ai_provider_keys').insert({
        provider,
        api_key_encrypted: apiKey,
        base_url: extra?.baseUrl ?? null,
        account_id: extra?.accountId ?? null,
      });
      if (insertError) throw insertError;
    }
  },

  async clearKey(provider: AiProvider): Promise<void> {
    const { error } = await supabase
      .from('ai_provider_keys')
      .update({ api_key_encrypted: null, last_test_status: null, last_tested_at: null, updated_at: new Date().toISOString() })
      .eq('provider', provider);
    if (error) throw error;
  },
};
