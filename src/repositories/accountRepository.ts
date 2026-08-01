import { supabase } from '@/services/supabase';
import type { ExtendedConnectedAccount } from '@/types/social';

export const accountRepository = {
  async list(workspaceId: string): Promise<ExtendedConnectedAccount[]> {
    const { data, error } = await supabase
      .from('connected_accounts')
      .select('id,workspace_id,platform,handle,status,metadata,provider_account_id,permissions,sync_status,last_synced_at,health_status,token_expires_at,created_at,updated_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as ExtendedConnectedAccount[];
  },

  async connect(input: {
    workspace_id: string;
    platform: string;
    handle: string | null;
    provider_account_id: string;
    access_token: string;
    refresh_token?: string;
    token_expires_at?: string;
    permissions?: string[];
  }): Promise<ExtendedConnectedAccount> {
    const { data: userData } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from('connected_accounts')
      .insert({
        workspace_id: input.workspace_id,
        platform: input.platform,
        handle: input.handle,
        provider_account_id: input.provider_account_id,
        access_token_encrypted: input.access_token,
        refresh_token_encrypted: input.refresh_token ?? null,
        token_expires_at: input.token_expires_at ?? null,
        permissions: input.permissions ?? [],
        status: 'connected',
        sync_status: 'synced',
        health_status: 'healthy',
        last_synced_at: new Date().toISOString(),
        metadata: { connected_by: userData.user?.id },
      })
      .select('id,workspace_id,platform,handle,status,metadata,provider_account_id,permissions,sync_status,last_synced_at,health_status,token_expires_at,created_at,updated_at')
      .single();
    if (error) throw error;
    return data as ExtendedConnectedAccount;
  },

  async disconnect(id: string): Promise<void> {
    const { error } = await supabase
      .from('connected_accounts')
      .update({ status: 'disconnected', health_status: 'unknown', sync_status: 'idle', access_token_encrypted: null, refresh_token_encrypted: null, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('connected_accounts').delete().eq('id', id);
    if (error) throw error;
  },

  async refreshStatus(id: string): Promise<void> {
    const { error } = await supabase
      .from('connected_accounts')
      .update({ sync_status: 'synced', last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },
};
