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
    // globalized), so a plain UPDATE is enough. We check `error` AND the
    // returned rows: RLS silently filters out rows the caller isn't allowed
    // to touch (super-admin-only here) without raising a PostgREST error,
    // so a 0-row result on success is actually a permissions failure and
    // must not be reported as "saved".
    const { data, error } = await supabase
      .from('ai_provider_keys')
      .update({
        api_key_encrypted: apiKey,
        base_url: extra?.baseUrl ?? null,
        account_id: extra?.accountId ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('provider', provider)
      .select('provider');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('لم يتم حفظ المفتاح: الحساب الحالي ليس Super Admin أو المزوّد غير موجود.');
    }
  },

  async clearKey(provider: AiProvider): Promise<void> {
    const { data, error } = await supabase
      .from('ai_provider_keys')
      .update({ api_key_encrypted: null, last_test_status: null, last_tested_at: null, updated_at: new Date().toISOString() })
      .eq('provider', provider)
      .select('provider');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('لم يتم حذف المفتاح: الحساب الحالي ليس Super Admin أو المزوّد غير موجود.');
    }
  },
};
