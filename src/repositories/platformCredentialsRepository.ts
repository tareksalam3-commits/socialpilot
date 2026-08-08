import { supabase } from '@/services/supabase';

export type CredentialKey =
  | 'meta_app_id'
  | 'meta_app_secret'
  | 'meta_config_id'
  | 'linkedin_client_id'
  | 'linkedin_client_secret'
  | 'x_client_id'
  | 'x_client_secret'
  | 'threads_app_id'
  | 'threads_app_secret'
  | 'tiktok_client_key'
  | 'tiktok_client_secret'
  | 'app_url';

export type CredentialStatus = {
  configured: boolean;
  updated_at: string | null;
  value?: string;
};

export const platformCredentialsRepository = {
  async list(): Promise<Record<CredentialKey, CredentialStatus>> {
    const { data, error } = await supabase.functions.invoke<{ credentials: Record<CredentialKey, CredentialStatus> }>(
      'platform-credentials',
      { method: 'GET' },
    );
    if (error) throw error;
    return data!.credentials;
  },

  /** Saves one or more credentials at once. Values are written straight into
   * Supabase (the `platform_credentials` table) and picked up by the OAuth
   * edge functions on their next call — no redeploy needed. */
  async save(values: Partial<Record<CredentialKey, string>>): Promise<void> {
    const { data, error } = await supabase.functions.invoke<{ saved: string[] }>('platform-credentials', {
      method: 'POST',
      body: values,
    });
    if (error || !data?.saved?.length) throw new Error(error?.message ?? 'Could not save credentials');
  },

  async remove(key: CredentialKey): Promise<void> {
    const { error } = await supabase.functions.invoke('platform-credentials', {
      method: 'DELETE',
      body: { key },
    });
    if (error) throw error;
  },
};
