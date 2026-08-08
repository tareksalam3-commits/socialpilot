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

  /** Forces an immediate token refresh for a connected account instead of
   * waiting for the cron sweep. Facebook/Instagram, LinkedIn, X, Threads and
   * TikTok all support this (LinkedIn/X additionally require a refresh_token
   * captured at connect time — otherwise the account needs reconnecting via
   * OAuth). Telegram and WhatsApp accounts don't expire on a schedule, so
   * this is never called for them (see PlatformDefinition.supportsRefresh). */
  async refreshToken(id: string, platform: string): Promise<void> {
    const fnByPlatform: Record<string, string> = {
      linkedin: 'linkedin-token-refresh',
      linkedin_page: 'linkedin-token-refresh',
      x: 'x-token-refresh',
      threads: 'threads-token-refresh',
      tiktok: 'tiktok-token-refresh',
    };
    const fn = fnByPlatform[platform] ?? 'meta-token-refresh';
    const { data, error } = await supabase.functions.invoke<{ refreshed: boolean }>(fn, {
      body: { account_id: id },
    });
    if (error || !data?.refreshed) throw new Error(error?.message ?? 'Could not refresh this token');
  },

  /** Re-verifies a single account against the platform (token still valid?
   * handle changed?) and updates its sync/health status accordingly. */
  async sync(id: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke<{ synced: number }>('account-sync', {
      body: { account_id: id },
    });
    if (error || !data) throw new Error(error?.message ?? 'Could not sync this account');
  },

  /** Re-verifies every connected account in the workspace in one pass. */
  async syncAll(workspaceId: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke<{ synced: number }>('account-sync', {
      body: { workspace_id: workspaceId },
    });
    if (error || !data) throw new Error(error?.message ?? 'Could not sync accounts');
  },

  async startMetaOAuth(workspaceId: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke<{ url: string }>('meta-oauth-connect', {
      body: { workspace_id: workspaceId },
    });
    if (error || !data?.url) throw new Error(error?.message ?? 'Could not start Facebook login');
    return data.url;
  },

  async startLinkedInOAuth(workspaceId: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke<{ url: string }>('linkedin-oauth-connect', {
      body: { workspace_id: workspaceId },
    });
    if (error || !data?.url) throw new Error(error?.message ?? 'Could not start LinkedIn login');
    return data.url;
  },

  async startXOAuth(workspaceId: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke<{ url: string }>('x-oauth-connect', {
      body: { workspace_id: workspaceId },
    });
    if (error || !data?.url) throw new Error(error?.message ?? 'Could not start X login');
    return data.url;
  },

  async startThreadsOAuth(workspaceId: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke<{ url: string }>('threads-oauth-connect', {
      body: { workspace_id: workspaceId },
    });
    if (error || !data?.url) throw new Error(error?.message ?? 'Could not start Threads login');
    return data.url;
  },

  async startTikTokOAuth(workspaceId: string): Promise<string> {
    const { data, error } = await supabase.functions.invoke<{ url: string }>('tiktok-oauth-connect', {
      body: { workspace_id: workspaceId },
    });
    if (error || !data?.url) throw new Error(error?.message ?? 'Could not start TikTok login');
    return data.url;
  },

  /** Telegram has no redirect OAuth dialog — the bot token comes from
   * BotFather and is verified live against the Bot API on the server. */
  async connectTelegram(workspaceId: string, botToken: string, chatId: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke<{ connected: boolean }>('telegram-connect', {
      body: { workspace_id: workspaceId, bot_token: botToken, chat_id: chatId },
    });
    if (error || !data?.connected) throw new Error(error?.message ?? 'Could not connect this Telegram bot/chat');
  },

  /** WhatsApp Business Cloud API accounts are provisioned in Meta Business
   * Manager — the System User access token + phone number ID are verified
   * live against the Graph API on the server, same idea as Telegram. */
  async connectWhatsApp(workspaceId: string, accessToken: string, phoneNumberId: string, wabaId: string, defaultRecipient: string): Promise<void> {
    const { data, error } = await supabase.functions.invoke<{ connected: boolean }>('whatsapp-connect', {
      body: { workspace_id: workspaceId, access_token: accessToken, phone_number_id: phoneNumberId, waba_id: wabaId, default_recipient: defaultRecipient },
    });
    if (error || !data?.connected) throw new Error(error?.message ?? 'Could not connect this WhatsApp Business number');
  },

  async getPendingSelection(id: string): Promise<{ platform: 'meta' | 'linkedin'; options: OAuthOption[] }> {
    const { data, error } = await supabase.functions.invoke<{ platform: 'meta' | 'linkedin'; options: OAuthOption[] }>(
      `oauth-selection?id=${encodeURIComponent(id)}`,
      { method: 'GET' },
    );
    if (error || !data) throw new Error(error?.message ?? 'Selection not found or expired');
    return data;
  },

  async finalizeSelection(id: string, selected: Array<{ id: string; connect_instagram?: boolean }>): Promise<number> {
    const { data, error } = await supabase.functions.invoke<{ connected: number }>('oauth-selection', {
      body: { id, selected },
    });
    if (error || !data) throw new Error(error?.message ?? 'Could not connect the selected accounts');
    return data.connected;
  },
};

export type MetaOAuthOption = {
  id: string;
  name: string;
  instagram: { id: string; username: string } | null;
};

export type LinkedInOAuthOption = {
  type: 'personal' | 'organization';
  id: string;
  name: string;
};

export type OAuthOption = MetaOAuthOption | LinkedInOAuthOption;
