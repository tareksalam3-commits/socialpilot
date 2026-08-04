import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Facebook, Instagram, Link2, Linkedin, Loader2, Plus, RefreshCw, RotateCw, Trash2, XCircle } from 'lucide-react';
import { useAccounts } from '@/hooks/useAccounts';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { accountRepository, type LinkedInOAuthOption, type MetaOAuthOption, type OAuthOption } from '@/repositories/accountRepository';
import { Badge, Button, Card, EmptyState, ErrorState, Modal, Input } from '@/ui';
import { formatDate } from '@/utils/format';
import type { ExtendedConnectedAccount } from '@/types/social';

const platforms = [
  { id: 'facebook', label: 'Facebook Page', icon: Facebook, color: 'text-blue-600' },
  { id: 'instagram', label: 'Instagram Business', icon: Instagram, color: 'text-pink-600' },
  { id: 'linkedin', label: 'LinkedIn Profile', icon: Linkedin, color: 'text-blue-700' },
  { id: 'linkedin_page', label: 'LinkedIn Company Page', icon: Linkedin, color: 'text-blue-800' },
];

export function ConnectedAccountsPage() {
  const { accounts, loading, error, disconnect, remove, reload, refreshToken, refreshingId, syncAccount, syncingId, syncAll, syncingAll } = useAccounts();
  const { workspace } = useWorkspace();
  const { push } = useToast();
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();

  const [showConnect, setShowConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectForm, setConnectForm] = useState({ platform: 'facebook', handle: '', accessToken: '', providerAccountId: '' });

  const [oauthLoading, setOauthLoading] = useState<'meta' | 'linkedin' | null>(null);
  const [selection, setSelection] = useState<{ id: string; platform: 'meta' | 'linkedin'; options: OAuthOption[] } | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [igChecked, setIgChecked] = useState<Record<string, boolean>>({});
  const [finalizing, setFinalizing] = useState(false);

  // Resume an OAuth callback: the edge function redirects back here with
  // either ?selection=<id>&platform=meta|linkedin or ?error=... on failure.
  useEffect(() => {
    const selectionId = searchParams.get('selection');
    const platform = searchParams.get('platform') as 'meta' | 'linkedin' | null;
    const oauthError = searchParams.get('error');

    if (oauthError) {
      push({ title: t('accounts.toast.oauthConnectionFailed', { platform: platform === 'linkedin' ? 'LinkedIn' : 'Facebook' }), description: oauthError.replace(/_/g, ' '), variant: 'error' });
      setSearchParams((p) => { p.delete('error'); p.delete('platform'); return p; }, { replace: true });
      return;
    }

    if (selectionId && platform) {
      accountRepository
        .getPendingSelection(selectionId)
        .then((data) => setSelection({ id: selectionId, platform: data.platform, options: data.options }))
        .catch((e) => push({ title: t('accounts.toast.loadSelectionFailed'), description: e instanceof Error ? e.message : '', variant: 'error' }))
        .finally(() => setSearchParams((p) => { p.delete('selection'); p.delete('platform'); return p; }, { replace: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleMetaConnect = async () => {
    if (!workspace) return;
    setOauthLoading('meta');
    try {
      const url = await accountRepository.startMetaOAuth(workspace.id);
      window.location.href = url;
    } catch (e) {
      push({ title: t('accounts.toast.facebookLoginFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
      setOauthLoading(null);
    }
  };

  const handleLinkedInConnect = async () => {
    if (!workspace) return;
    setOauthLoading('linkedin');
    try {
      const url = await accountRepository.startLinkedInOAuth(workspace.id);
      window.location.href = url;
    } catch (e) {
      push({ title: t('accounts.toast.linkedinLoginFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
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
      push({ title: `${count} account${count === 1 ? '' : 's'} connected`, variant: 'success' });
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
    if (!workspace) return;
    setConnecting(true);
    try {
      await accountRepository.connect({
        workspace_id: workspace.id,
        platform: connectForm.platform,
        handle: connectForm.handle || null,
        provider_account_id: connectForm.providerAccountId,
        access_token: connectForm.accessToken,
      });
      push({ title: 'Account connected', description: 'Your social account is now linked.', variant: 'success' });
      setShowConnect(false);
      setConnectForm({ platform: 'facebook', handle: '', accessToken: '', providerAccountId: '' });
      reload();
    } catch (e) {
      push({ title: t('accounts.toast.connectionFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (account: ExtendedConnectedAccount) => {
    await disconnect(account.id);
    push({ title: 'Account disconnected', variant: 'success' });
  };

  const handleRefreshToken = async (account: ExtendedConnectedAccount) => {
    try {
      await refreshToken(account.id, account.platform);
      push({ title: 'Token refreshed', description: `${platformLabel(account.platform)} will stay connected for longer.`, variant: 'success' });
    } catch (e) {
      push({ title: t('accounts.toast.refreshFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const handleSync = async (account: ExtendedConnectedAccount) => {
    try {
      await syncAccount(account.id);
      push({ title: 'Account synced', description: `${platformLabel(account.platform)} status is up to date.`, variant: 'success' });
    } catch (e) {
      push({ title: t('accounts.toast.syncFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const handleSyncAll = async () => {
    try {
      await syncAll();
      push({ title: 'Accounts synced', variant: 'success' });
    } catch (e) {
      push({ title: t('accounts.toast.syncAllFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Connected Accounts</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage your social media accounts and their health.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button className="col-span-2 sm:col-span-1" variant="outline" onClick={handleSyncAll} loading={syncingAll} disabled={accounts.length === 0}>
            <RotateCw className="h-4 w-4" /> Sync all
          </Button>
          <Button className="col-span-2 sm:col-span-1" onClick={handleMetaConnect} loading={oauthLoading === 'meta'} disabled={oauthLoading !== null}>
            <Facebook className="h-4 w-4" /> Continue with Facebook
          </Button>
          <Button className="col-span-2 sm:col-span-1" onClick={handleLinkedInConnect} loading={oauthLoading === 'linkedin'} disabled={oauthLoading !== null} variant="outline">
            <Linkedin className="h-4 w-4" /> Continue with LinkedIn
          </Button>
          <Button className="col-span-2 sm:col-span-1" variant="ghost" onClick={() => setShowConnect(true)}>
            <Plus className="h-4 w-4" /> Manual
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <Card key={account.id}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                  <PlatformIcon platform={account.platform} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{platformLabel(account.platform)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{account.handle ?? 'Connected'}</p>
                </div>
              </div>
              <HealthBadge status={account.health_status} />
            </div>
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Status</span>
                <Badge variant={account.status === 'connected' ? 'success' : 'error'}>{account.status}</Badge>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Sync</span>
                <Badge variant={account.sync_status === 'synced' ? 'success' : account.sync_status === 'error' ? 'error' : 'default'}>{account.sync_status}</Badge>
              </div>
              {account.token_expires_at && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Token expires</span>
                  <span className={isExpiringSoon(account.token_expires_at) ? 'font-medium text-amber-600 dark:text-amber-400' : 'text-slate-700 dark:text-slate-300'}>
                    {formatDate(account.token_expires_at)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Connected</span>
                <span className="text-slate-700 dark:text-slate-300">{formatDate(account.created_at)}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-2">
                {account.status === 'connected' && (
                  <Button size="sm" variant="outline" onClick={() => handleRefreshToken(account)} loading={refreshingId === account.id}>
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh token
                  </Button>
                )}
                {account.status === 'connected' && (
                  <Button size="sm" variant="outline" onClick={() => handleSync(account)} loading={syncingId === account.id}>
                    <RotateCw className="h-3.5 w-3.5" /> Sync
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => handleDisconnect(account)}>Disconnect</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(account.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {error && <ErrorState description={error} />}
      {loading && accounts.length === 0 && <p className="text-center text-sm text-slate-500">{t('accounts.loading')}</p>}
      {!loading && accounts.length === 0 && !error && (
        <Card><EmptyState icon={<Link2 className="h-10 w-10" />} title="No accounts connected" description="Connect a Facebook Page or LinkedIn account to start publishing." /></Card>
      )}

      <Modal
        open={!!selection}
        onClose={() => setSelection(null)}
        title={selection?.platform === 'linkedin' ? 'Select LinkedIn accounts' : 'Select Facebook Pages'}
        description="Choose which accounts to connect to this workspace."
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setSelection(null)}>Cancel</Button>
            <Button onClick={handleFinalizeSelection} loading={finalizing}>Connect selected</Button>
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
                  <label className="mt-2 flex items-center gap-2 pl-6 text-xs text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      disabled={!checked[page.id]}
                      checked={!!igChecked[page.id]}
                      onChange={(e) => setIgChecked({ ...igChecked, [page.id]: e.target.checked })}
                    />
                    Also connect Instagram @{page.instagram.username}
                  </label>
                )}
              </div>
            ))}
          {selection?.platform === 'linkedin' &&
            (selection.options as LinkedInOAuthOption[]).map((opt) => (
              <label key={opt.id} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm font-medium text-slate-900 dark:border-slate-700 dark:text-white">
                <input type="checkbox" checked={!!checked[opt.id]} onChange={(e) => setChecked({ ...checked, [opt.id]: e.target.checked })} />
                {opt.name} <span className="text-xs font-normal text-slate-500">{opt.type === 'personal' ? '(Personal profile)' : '(Company Page)'}</span>
              </label>
            ))}
          {selection && selection.options.length === 0 && <p className="text-sm text-slate-500">Nothing found to connect.</p>}
        </div>
      </Modal>

      <Modal
        open={showConnect}
        onClose={() => setShowConnect(false)}
        title="Connect Manually"
        description="Advanced: paste an access token directly, for platforms without OAuth set up yet."
        size="md"
        footer={<><Button variant="outline" onClick={() => setShowConnect(false)}>Cancel</Button><Button onClick={handleConnect} loading={connecting}>Connect</Button></>}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Platform</label>
            <select value={connectForm.platform} onChange={(e) => setConnectForm({ ...connectForm, platform: e.target.value })} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
              {platforms.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <Input label="Handle (optional)" value={connectForm.handle} onChange={(e) => setConnectForm({ ...connectForm, handle: e.target.value })} placeholder="@yourbrand" />
          <Input label="Provider Account ID" value={connectForm.providerAccountId} onChange={(e) => setConnectForm({ ...connectForm, providerAccountId: e.target.value })} placeholder="123456789" />
          <Input label="Access Token" type="password" value={connectForm.accessToken} onChange={(e) => setConnectForm({ ...connectForm, accessToken: e.target.value })} placeholder="EAAB…" />
          <p className="text-xs text-slate-500 dark:text-slate-400">Your access token is stored server-side and never exposed back to the browser.</p>
        </div>
      </Modal>
    </div>
  );
}

function isExpiringSoon(expiresAt: string): boolean {
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  return msRemaining < 10 * 24 * 60 * 60 * 1000;
}

function platformLabel(platform: string): string {
  return platforms.find((p) => p.id === platform)?.label ?? platform;
}

function PlatformIcon({ platform }: { platform: string }) {
  const match = platforms.find((p) => p.id === platform);
  const Icon = match?.icon ?? Loader2;
  return <Icon className={`h-5 w-5 ${match?.color ?? 'text-slate-500'}`} />;
}

function HealthBadge({ status }: { status: string }) {
  if (status === 'healthy') return <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Healthy</Badge>;
  if (status === 'warning') return <Badge variant="warning">Warning</Badge>;
  if (status === 'error') return <Badge variant="error"><XCircle className="mr-1 h-3 w-3" /> Error</Badge>;
  return <Badge>Unknown</Badge>;
}
