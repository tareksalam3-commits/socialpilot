import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { CheckCircle2, Link2, Loader2, Plus, RotateCw, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { useAccounts } from '@/hooks/useAccounts';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { accountRepository, type LinkedInOAuthOption, type MetaOAuthOption, type OAuthOption } from '@/repositories/accountRepository';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Input, Skeleton } from '@/ui';
import { formatDate } from '@/utils/format';
import type { ExtendedConnectedAccount } from '@/types/social';
import { PLATFORM_DEFINITIONS, getPlatformMeta, platformLabelFallback } from '@/constants/platforms';
import {
  startOAuthConnect,
  isRedirectConnectMethod,
  REDIRECT_CONNECT_LABEL,
  getAccountDisplayStatus,
  needsReconnect,
  type RedirectConnectMethod,
  type AccountDisplayStatus,
} from '@/integrations/socialIntegrationManager';

// Kept for the query-string contract with the OAuth callback redirects
// (?platform=meta|linkedin|x|threads|tiktok) — those Edge Functions are
// untouched, so the values here must keep matching exactly what they send.
type RedirectOAuthPlatform = 'meta' | 'linkedin' | 'x' | 'threads' | 'tiktok';
const PLATFORM_TO_CONNECT_METHOD: Record<RedirectOAuthPlatform, RedirectConnectMethod> = {
  meta: 'meta_oauth',
  linkedin: 'linkedin_oauth',
  x: 'x_oauth',
  threads: 'threads_oauth',
  tiktok: 'tiktok_oauth',
};

export function ConnectedAccountsPage() {
  const { accounts, loading, error, disconnect, remove, reload, refreshToken, refreshingId, syncAccount, syncingId, syncAll, syncingAll } = useAccounts();
  const { user } = useAuth();
  const { workspace, loading: wsLoading, ensureWorkspace } = useWorkspace();
  const { push } = useToast();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const [preparingWorkspace, setPreparingWorkspace] = useState(false);

  // Make sure the user has a workspace before they try to connect anything.
  // Without this, every OAuth button silently no-ops when workspace is null.
  useEffect(() => {
    if (!wsLoading && !workspace && user) {
      setPreparingWorkspace(true);
      ensureWorkspace().finally(() => setPreparingWorkspace(false));
    }
  }, [wsLoading, workspace, user, ensureWorkspace]);

  const [showConnect, setShowConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectForm, setConnectForm] = useState({ platform: 'facebook', handle: '', accessToken: '', providerAccountId: '' });

  const [oauthLoading, setOauthLoading] = useState<RedirectOAuthPlatform | null>(null);
  const [selection, setSelection] = useState<{ id: string; platform: 'meta' | 'linkedin'; options: OAuthOption[] } | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [igChecked, setIgChecked] = useState<Record<string, boolean>>({});
  const [finalizing, setFinalizing] = useState(false);

  const [showTelegram, setShowTelegram] = useState(false);
  const [telegramForm, setTelegramForm] = useState({ botToken: '', chatId: '' });
  const [connectingTelegram, setConnectingTelegram] = useState(false);

  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [whatsappForm, setWhatsappForm] = useState({ accessToken: '', phoneNumberId: '', wabaId: '', defaultRecipient: '' });
  const [connectingWhatsApp, setConnectingWhatsApp] = useState(false);

  // Resume an OAuth callback. The edge functions redirect back here with one of:
  //  - ?selection=<id>&platform=meta|linkedin  (Meta/LinkedIn: a Page/Org picker is needed)
  //  - ?connected=1&platform=x|threads|tiktok  (single-account platforms: nothing left to pick)
  //  - ?error=...&platform=...                  (failure, any platform)
  useEffect(() => {
    const selectionId = searchParams.get('selection');
    const connected = searchParams.get('connected');
    const platform = searchParams.get('platform') as RedirectOAuthPlatform | null;
    const oauthError = searchParams.get('error');

    if (oauthError) {
      push({ title: t('accounts.toast.oauthConnectionFailed', { platform: platform ? REDIRECT_CONNECT_LABEL[PLATFORM_TO_CONNECT_METHOD[platform]] ?? platform : 'Platform' }), description: oauthError.replace(/_/g, ' '), variant: 'error' });
      setSearchParams((p) => { p.delete('error'); p.delete('platform'); return p; }, { replace: true });
      return;
    }

    if (connected && platform) {
      push({ title: t('accounts.toast.platformConnected', { platform: REDIRECT_CONNECT_LABEL[PLATFORM_TO_CONNECT_METHOD[platform]] ?? platform }), variant: 'success' });
      setSearchParams((p) => { p.delete('connected'); p.delete('platform'); return p; }, { replace: true });
      reload();
      return;
    }

    if (selectionId && (platform === 'meta' || platform === 'linkedin')) {
      accountRepository
        .getPendingSelection(selectionId)
        .then((data) => setSelection({ id: selectionId, platform: data.platform, options: data.options }))
        .catch((e) => push({ title: t('accounts.toast.loadSelectionFailed'), description: e instanceof Error ? e.message : '', variant: 'error' }))
        .finally(() => setSearchParams((p) => { p.delete('selection'); p.delete('platform'); return p; }, { replace: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single Integration Manager entry point for every redirect-OAuth
  // platform: picks the right Edge Function via connectMethod instead of
  // each platform having its own copy-pasted handler. Meta and LinkedIn go
  // through this exact same path they always did — only the dispatch is
  // unified, not the underlying OAuth call.
  const startRedirectOAuth = async (platform: RedirectOAuthPlatform) => {
    if (!workspace) {
      push({ title: t('accounts.workspaceNotReady.title'), description: t('accounts.workspaceNotReady.description'), variant: 'error' });
      return;
    }
    setOauthLoading(platform);
    try {
      const url = await startOAuthConnect(PLATFORM_TO_CONNECT_METHOD[platform], workspace.id);
      window.location.href = url;
    } catch (e) {
      push({
        title: t('accounts.toast.oauthConnectionFailed', { platform: REDIRECT_CONNECT_LABEL[PLATFORM_TO_CONNECT_METHOD[platform]] }),
        description: e instanceof Error ? e.message : '',
        variant: 'error',
      });
      setOauthLoading(null);
    }
  };

  const handleFinalizeSelection = async () => {
    if (!selection) return;
    const selected = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([id]) => ({ id, connect_instagram: !!igChecked[id] }));
    if (selected.length === 0) {
      push({ title: t('accounts.toast.pickAtLeastOne'), variant: 'error' });
      return;
    }
    setFinalizing(true);
    try {
      const count = await accountRepository.finalizeSelection(selection.id, selected);
      push({ title: t('accounts.toast.accountsConnectedCount', { count }), variant: 'success' });
      setSelection(null);
      setChecked({});
      setIgChecked({});
      reload();
    } catch (e) {
      push({ title: t('accounts.toast.connectSelectedFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setFinalizing(false);
    }
  };

  const handleConnect = async () => {
    if (!connectForm.accessToken.trim() || !connectForm.providerAccountId.trim()) {
      push({ title: t('accounts.toast.tokenAndIdRequired'), variant: 'error' });
      return;
    }
    if (!workspace) { push({ title: t('accounts.workspaceNotReady.title'), description: t('accounts.workspaceNotReady.description'), variant: 'error' }); return; }
    setConnecting(true);
    try {
      await accountRepository.connect({
        workspace_id: workspace.id,
        platform: connectForm.platform,
        handle: connectForm.handle || null,
        provider_account_id: connectForm.providerAccountId,
        access_token: connectForm.accessToken,
      });
      push({ title: t('accounts.toast.accountConnected'), description: t('accounts.toast.accountConnectedDesc'), variant: 'success' });
      setShowConnect(false);
      setConnectForm({ platform: 'facebook', handle: '', accessToken: '', providerAccountId: '' });
      reload();
    } catch (e) {
      push({ title: t('accounts.toast.connectionFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setConnecting(false);
    }
  };

  const handleTelegramConnect = async () => {
    if (!telegramForm.botToken.trim() || !telegramForm.chatId.trim()) {
      push({ title: t('accounts.toast.telegramFieldsRequired'), variant: 'error' });
      return;
    }
    if (!workspace) { push({ title: t('accounts.workspaceNotReady.title'), description: t('accounts.workspaceNotReady.description'), variant: 'error' }); return; }
    setConnectingTelegram(true);
    try {
      await accountRepository.connectTelegram(workspace.id, telegramForm.botToken.trim(), telegramForm.chatId.trim());
      push({ title: t('accounts.toast.platformConnected', { platform: 'Telegram' }), variant: 'success' });
      setShowTelegram(false);
      setTelegramForm({ botToken: '', chatId: '' });
      reload();
    } catch (e) {
      push({ title: t('accounts.toast.telegramConnectFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setConnectingTelegram(false);
    }
  };

  const handleWhatsAppConnect = async () => {
    if (!whatsappForm.accessToken.trim() || !whatsappForm.phoneNumberId.trim()) {
      push({ title: t('accounts.toast.whatsappFieldsRequired'), variant: 'error' });
      return;
    }
    if (!workspace) { push({ title: t('accounts.workspaceNotReady.title'), description: t('accounts.workspaceNotReady.description'), variant: 'error' }); return; }
    setConnectingWhatsApp(true);
    try {
      await accountRepository.connectWhatsApp(workspace.id, whatsappForm.accessToken.trim(), whatsappForm.phoneNumberId.trim(), whatsappForm.wabaId.trim(), whatsappForm.defaultRecipient.trim());
      push({ title: t('accounts.toast.platformConnected', { platform: 'WhatsApp Business' }), variant: 'success' });
      setShowWhatsApp(false);
      setWhatsappForm({ accessToken: '', phoneNumberId: '', wabaId: '', defaultRecipient: '' });
      reload();
    } catch (e) {
      push({ title: t('accounts.toast.whatsappConnectFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setConnectingWhatsApp(false);
    }
  };

  const handleDisconnect = async (account: ExtendedConnectedAccount) => {
    await disconnect(account.id);
    push({ title: t('accounts.toast.accountDisconnected'), variant: 'success' });
  };

  const handleRefreshToken = async (account: ExtendedConnectedAccount) => {
    try {
      await refreshToken(account.id, account.platform);
      push({ title: t('accounts.toast.tokenRefreshed'), description: t('accounts.toast.tokenRefreshedDesc', { platform: platformLabelFallback(account.platform) }), variant: 'success' });
    } catch (e) {
      push({ title: t('accounts.toast.refreshFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const handleSync = async (account: ExtendedConnectedAccount) => {
    try {
      await syncAccount(account.id);
      push({ title: t('accounts.toast.accountSynced'), description: t('accounts.toast.accountSyncedDesc', { platform: platformLabelFallback(account.platform) }), variant: 'success' });
    } catch (e) {
      push({ title: t('accounts.toast.syncFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  // Unified Reconnect action (rule: every card gets one Reconnect path,
  // regardless of platform). Redirect-OAuth platforms restart the exact same
  // connect flow as a first-time Connect; manual platforms (Telegram/
  // WhatsApp) reopen their form so the user can re-verify/replace the token.
  const handleReconnect = (account: ExtendedConnectedAccount) => {
    const meta = getPlatformMeta(account.platform);
    if (!meta) return;
    if (isRedirectConnectMethod(meta.connectMethod)) {
      if (!workspace) {
        push({ title: t('accounts.workspaceNotReady.title'), description: t('accounts.workspaceNotReady.description'), variant: 'error' });
        return;
      }
      setOauthLoading(meta.connectMethod.replace('_oauth', '') as RedirectOAuthPlatform);
      startOAuthConnect(meta.connectMethod, workspace.id)
        .then((url) => { window.location.href = url; })
        .catch((e) => {
          push({ title: t('accounts.toast.oauthConnectionFailed', { platform: meta.label }), description: e instanceof Error ? e.message : '', variant: 'error' });
          setOauthLoading(null);
        });
      return;
    }
    if (account.platform === 'telegram') setShowTelegram(true);
    else if (account.platform === 'whatsapp') setShowWhatsApp(true);
  };

  const handleSyncAll = async () => {
    try {
      await syncAll();
      push({ title: t('accounts.toast.accountsSynced'), variant: 'success' });
    } catch (e) {
      push({ title: t('accounts.toast.syncAllFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const socialAccounts = accounts.filter((a) => getPlatformMeta(a.platform)?.category !== 'messaging');
  const messagingAccounts = accounts.filter((a) => getPlatformMeta(a.platform)?.category === 'messaging');

  const connectedCount = accounts.filter((a) => a.status === 'connected').length;
  const workspaceReady = !!workspace && !preparingWorkspace;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('accounts.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('accounts.subtitle')}</p>
          <div className="mt-3 flex items-center gap-2">
            <Badge variant={connectedCount > 0 ? 'success' : 'default'}>
              {t('accounts.connectedCount', { count: connectedCount })}
            </Badge>
            {preparingWorkspace && (
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('accounts.settingUpWorkspace')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleSyncAll} loading={syncingAll} disabled={accounts.length === 0}>
            <RotateCw className="h-4 w-4" /> {t('accounts.syncAll')}
          </Button>
          <Button variant="ghost" onClick={() => setShowConnect(true)}>
            <Plus className="h-4 w-4" /> {t('accounts.manual')}
          </Button>
        </div>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('accounts.socialNetworks')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('accounts.socialNetworksDesc')}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          <ConnectTile
            platformId="facebook"
            label="Meta"
            sublabel="Facebook & Instagram"
            onClick={() => startRedirectOAuth('meta')}
            loading={oauthLoading === 'meta'}
            disabled={oauthLoading !== null || !workspaceReady}
          />
          <ConnectTile
            platformId="linkedin"
            label="LinkedIn"
            onClick={() => startRedirectOAuth('linkedin')}
            loading={oauthLoading === 'linkedin'}
            disabled={oauthLoading !== null || !workspaceReady}
          />
          <ConnectTile
            platformId="x"
            label="X"
            onClick={() => startRedirectOAuth('x')}
            loading={oauthLoading === 'x'}
            disabled={oauthLoading !== null || !workspaceReady}
          />
          <ConnectTile
            platformId="threads"
            label="Threads"
            onClick={() => startRedirectOAuth('threads')}
            loading={oauthLoading === 'threads'}
            disabled={oauthLoading !== null || !workspaceReady}
          />
          <ConnectTile
            platformId="tiktok"
            label="TikTok"
            onClick={() => startRedirectOAuth('tiktok')}
            loading={oauthLoading === 'tiktok'}
            disabled={oauthLoading !== null || !workspaceReady}
          />
        </div>

        {socialAccounts.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {socialAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onDisconnect={() => handleDisconnect(account)}
                onRemove={() => remove(account.id)}
                onRefresh={() => handleRefreshToken(account)}
                onSync={() => handleSync(account)}
                onReconnect={() => handleReconnect(account)}
                refreshing={refreshingId === account.id}
                syncing={syncingId === account.id}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('accounts.messagingChannels')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('accounts.messagingChannelsDesc')}</p>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          <ConnectTile
            platformId="telegram"
            label="Telegram"
            onClick={() => setShowTelegram(true)}
            disabled={!workspaceReady}
          />
          <ConnectTile
            platformId="whatsapp"
            label="WhatsApp"
            sublabel="Business"
            onClick={() => setShowWhatsApp(true)}
            disabled={!workspaceReady}
          />
        </div>

        {messagingAccounts.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {messagingAccounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                onDisconnect={() => handleDisconnect(account)}
                onRemove={() => remove(account.id)}
                onRefresh={() => handleRefreshToken(account)}
                onSync={() => handleSync(account)}
                onReconnect={() => handleReconnect(account)}
                refreshing={refreshingId === account.id}
                syncing={syncingId === account.id}
              />
            ))}
          </div>
        )}
      </section>

      {error && <ErrorState description={error} />}
      {(loading || wsLoading) && accounts.length === 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeletonAccount />
          <CardSkeletonAccount />
          <CardSkeletonAccount />
        </div>
      )}
      {!loading && !wsLoading && accounts.length === 0 && !error && (
        <Card><EmptyState icon={<Link2 className="h-10 w-10" />} title={t('accounts.empty.title')} description={t('accounts.empty.description')} /></Card>
      )}

      <Modal
        open={!!selection}
        onClose={() => setSelection(null)}
        title={selection?.platform === 'linkedin' ? t('accounts.modal.selectLinkedin') : t('accounts.modal.selectFacebook')}
        description={t('accounts.modal.selectDescription')}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setSelection(null)}>{t('common.cancel')}</Button>
            <Button onClick={handleFinalizeSelection} loading={finalizing}>{t('accounts.modal.connectSelected')}</Button>
          </>
        }
      >
        <div className="space-y-3">
          {selection?.platform === 'meta' &&
            (selection.options as MetaOAuthOption[]).map((page) => (
              <div key={page.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-900 dark:text-white">
                  <input type="checkbox" checked={!!checked[page.id]} onChange={(e) => setChecked({ ...checked, [page.id]: e.target.checked })} />
                  {page.name}
                </label>
                {page.instagram && (
                  <label className="mt-2 flex items-center gap-2 ps-6 text-xs text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      disabled={!checked[page.id]}
                      checked={!!igChecked[page.id]}
                      onChange={(e) => setIgChecked({ ...igChecked, [page.id]: e.target.checked })}
                    />
                    {t('accounts.modal.alsoConnectInstagram', { username: page.instagram.username })}
                  </label>
                )}
              </div>
            ))}
          {selection?.platform === 'linkedin' &&
            (selection.options as LinkedInOAuthOption[]).map((opt) => (
              <label key={opt.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-medium text-slate-900 dark:border-slate-700 dark:text-white">
                <input type="checkbox" checked={!!checked[opt.id]} onChange={(e) => setChecked({ ...checked, [opt.id]: e.target.checked })} />
                {opt.name} <span className="text-xs font-normal text-slate-500">{opt.type === 'personal' ? t('accounts.modal.personalProfile') : t('accounts.modal.companyPage')}</span>
              </label>
            ))}
          {selection && selection.options.length === 0 && <p className="text-sm text-slate-500">{t('accounts.modal.nothingToConnect')}</p>}
        </div>
      </Modal>

      <Modal
        open={showTelegram}
        onClose={() => setShowTelegram(false)}
        title={t('accounts.modal.connectTelegram')}
        description={t('accounts.modal.connectTelegramDesc')}
        size="md"
        footer={<><Button variant="outline" onClick={() => setShowTelegram(false)}>{t('common.cancel')}</Button><Button onClick={handleTelegramConnect} loading={connectingTelegram}>{t('accounts.modal.connect')}</Button></>}
      >
        <div className="space-y-4">
          <Input label={t('accounts.modal.botToken')} type="password" value={telegramForm.botToken} onChange={(e) => setTelegramForm({ ...telegramForm, botToken: e.target.value })} placeholder="123456789:AA…" />
          <Input label={t('accounts.modal.chatId')} value={telegramForm.chatId} onChange={(e) => setTelegramForm({ ...telegramForm, chatId: e.target.value })} placeholder="@mychannel or -1001234567890" />
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('accounts.modal.telegramVerifyNote')}</p>
        </div>
      </Modal>

      <Modal
        open={showWhatsApp}
        onClose={() => setShowWhatsApp(false)}
        title={t('accounts.modal.connectWhatsapp')}
        description={t('accounts.modal.connectWhatsappDesc')}
        size="md"
        footer={<><Button variant="outline" onClick={() => setShowWhatsApp(false)}>{t('common.cancel')}</Button><Button onClick={handleWhatsAppConnect} loading={connectingWhatsApp}>{t('accounts.modal.connect')}</Button></>}
      >
        <div className="space-y-4">
          <Input label={t('accounts.modal.systemUserToken')} type="password" value={whatsappForm.accessToken} onChange={(e) => setWhatsappForm({ ...whatsappForm, accessToken: e.target.value })} placeholder="EAAB…" />
          <Input label={t('accounts.modal.phoneNumberId')} value={whatsappForm.phoneNumberId} onChange={(e) => setWhatsappForm({ ...whatsappForm, phoneNumberId: e.target.value })} placeholder="1234567890" />
          <Input label={t('accounts.modal.wabaId')} value={whatsappForm.wabaId} onChange={(e) => setWhatsappForm({ ...whatsappForm, wabaId: e.target.value })} placeholder="1234567890" />
          <Input label={t('accounts.modal.defaultRecipient')} value={whatsappForm.defaultRecipient} onChange={(e) => setWhatsappForm({ ...whatsappForm, defaultRecipient: e.target.value })} placeholder="+201234567890" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('accounts.modal.whatsappNote')}
          </p>
        </div>
      </Modal>

      <Modal
        open={showConnect}
        onClose={() => setShowConnect(false)}
        title={t('accounts.modal.connectManually')}
        description={t('accounts.modal.connectManuallyDesc')}
        size="md"
        footer={<><Button variant="outline" onClick={() => setShowConnect(false)}>{t('common.cancel')}</Button><Button onClick={handleConnect} loading={connecting}>{t('accounts.modal.connect')}</Button></>}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('accounts.modal.platform')}</label>
            <select value={connectForm.platform} onChange={(e) => setConnectForm({ ...connectForm, platform: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              {PLATFORM_DEFINITIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <Input label={t('accounts.modal.handleOptional')} value={connectForm.handle} onChange={(e) => setConnectForm({ ...connectForm, handle: e.target.value })} placeholder="@yourbrand" />
          <Input label={t('accounts.modal.providerAccountId')} value={connectForm.providerAccountId} onChange={(e) => setConnectForm({ ...connectForm, providerAccountId: e.target.value })} placeholder="123456789" />
          <Input label={t('accounts.modal.accessToken')} type="password" value={connectForm.accessToken} onChange={(e) => setConnectForm({ ...connectForm, accessToken: e.target.value })} placeholder="EAAB…" />
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('accounts.modal.tokenStorageNote')}</p>
        </div>
      </Modal>
    </div>
  );
}

function ConnectTile({
  platformId,
  label,
  sublabel,
  onClick,
  loading = false,
  disabled = false,
}: {
  platformId: string;
  label: string;
  sublabel?: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const meta = getPlatformMeta(platformId);
  const Icon = meta?.icon ?? Loader2;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      title={sublabel ? `${label} — ${sublabel}` : label}
      className="press-effect group relative flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-center shadow-subtle transition-all duration-150 ease-snappy hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-subtle dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:focus-visible:ring-offset-slate-950"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 transition-colors duration-150 group-hover:bg-slate-200 dark:bg-slate-800 dark:group-hover:bg-slate-700">
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        ) : (
          <Icon className={`h-5 w-5 ${meta?.color ?? 'text-slate-500'}`} />
        )}
      </span>
      <span className="text-xs font-semibold leading-tight text-slate-900 dark:text-white">{label}</span>
      <span className="absolute end-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-900 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:bg-white dark:text-slate-900">
        <Plus className="h-2.5 w-2.5" />
      </span>
    </button>
  );
}

function CardSkeletonAccount() {
  return (
    <div className="animate-fade-in rounded-xl border border-slate-200 bg-white p-5 shadow-subtle dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

function AccountCard({
  account,
  onDisconnect,
  onRemove,
  onRefresh,
  onSync,
  onReconnect,
  refreshing,
  syncing,
}: {
  account: ExtendedConnectedAccount;
  onDisconnect: () => void;
  onRemove: () => void;
  onRefresh: () => void;
  onSync: () => void;
  onReconnect: () => void;
  refreshing: boolean;
  syncing: boolean;
}) {
  const { t } = useLanguage();
  const meta = getPlatformMeta(account.platform);
  const displayStatus = getAccountDisplayStatus(account);
  const showReconnect = needsReconnect(account);
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
            <PlatformIcon platform={account.platform} />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{platformLabelFallback(account.platform)}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{account.handle ?? t('accounts.card.connectedFallback')}</p>
          </div>
        </div>
        <StatusBadge status={displayStatus} />
      </div>
      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">{t('accounts.card.status')}</span>
          <Badge variant={account.status === 'connected' ? 'success' : 'error'}>{account.status}</Badge>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">{t('accounts.card.sync')}</span>
          <Badge variant={account.sync_status === 'synced' ? 'success' : account.sync_status === 'error' ? 'error' : 'default'}>{account.sync_status}</Badge>
        </div>
        {account.token_expires_at && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">{t('accounts.card.tokenExpires')}</span>
            <span className={displayStatus === 'expired' || isExpiringSoon(account.token_expires_at) ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}>
              {formatDate(account.token_expires_at)}
            </span>
          </div>
        )}
        {!account.token_expires_at && !meta?.supportsRefresh && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">{t('accounts.card.token')}</span>
            <span className="text-slate-700 dark:text-slate-300">{t('accounts.card.noExpiry')}</span>
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">{t('accounts.card.connectedAt')}</span>
          <span className="text-slate-700 dark:text-slate-300">{formatDate(account.created_at)}</span>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          {showReconnect && (
            <Button size="sm" onClick={onReconnect}>
              <RefreshCw className="h-3.5 w-3.5" /> {t('accounts.card.reconnect')}
            </Button>
          )}
          {account.status === 'connected' && meta?.supportsRefresh && (
            <Button size="sm" variant="outline" onClick={onRefresh} loading={refreshing}>
              <RefreshCw className="h-3.5 w-3.5" /> {t('accounts.card.refreshToken')}
            </Button>
          )}
          {account.status === 'connected' && (
            <Button size="sm" variant="outline" onClick={onSync} loading={syncing}>
              <RotateCw className="h-3.5 w-3.5" /> {t('accounts.card.syncAction')}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onDisconnect}>{t('accounts.card.disconnect')}</Button>
          <Button size="sm" variant="ghost" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
    </Card>
  );
}

function isExpiringSoon(expiresAt: string): boolean {
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  return msRemaining < 10 * 24 * 60 * 60 * 1000;
}

function PlatformIcon({ platform }: { platform: string }) {
  const match = getPlatformMeta(platform);
  const Icon = match?.icon ?? Loader2;
  return <Icon className={`h-5 w-5 ${match?.color ?? 'text-slate-500'}`} />;
}

/** Renders the Integration Manager's five-state status
 * (connected/disconnected/expired/error/warning) consistently across every
 * platform card. */
function StatusBadge({ status }: { status: AccountDisplayStatus }) {
  const { t } = useLanguage();
  if (status === 'connected') return <Badge variant="success"><CheckCircle2 className="me-1 h-3 w-3" /> {t('accounts.card.healthy')}</Badge>;
  if (status === 'expired') return <Badge variant="warning"><XCircle className="me-1 h-3 w-3" /> {t('accounts.card.expired')}</Badge>;
  if (status === 'warning') return <Badge variant="warning">{t('accounts.card.warning')}</Badge>;
  if (status === 'error') return <Badge variant="error"><XCircle className="me-1 h-3 w-3" /> {t('accounts.card.error')}</Badge>;
  if (status === 'disconnected') return <Badge>{t('accounts.card.disconnected')}</Badge>;
  return <Badge>{t('accounts.card.unknown')}</Badge>;
}
