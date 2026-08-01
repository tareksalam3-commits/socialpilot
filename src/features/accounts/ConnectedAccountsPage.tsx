import { useState } from 'react';
import { CheckCircle2, Facebook, Instagram, Link2, Linkedin, Plus, Trash2, XCircle } from 'lucide-react';
import { useAccounts } from '@/hooks/useAccounts';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { accountRepository } from '@/repositories/accountRepository';
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
  const { accounts, loading, error, disconnect, remove, reload } = useAccounts();
  const { workspace } = useWorkspace();
  const { push } = useToast();
  const [showConnect, setShowConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectForm, setConnectForm] = useState({ platform: 'facebook', handle: '', accessToken: '', providerAccountId: '' });

  const handleConnect = async () => {
    if (!connectForm.accessToken.trim() || !connectForm.providerAccountId.trim()) {
      push({ title: 'Access token and Account ID are required', variant: 'error' });
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
      push({ title: 'Connection failed', description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (account: ExtendedConnectedAccount) => {
    await disconnect(account.id);
    push({ title: 'Account disconnected', variant: 'success' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Connected Accounts</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage your social media accounts and their health.</p>
        </div>
        <Button onClick={() => setShowConnect(true)}>
          <Plus className="h-4 w-4" /> Connect Account
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {platforms.map((p) => {
          const account = accounts.find((a) => a.platform === p.id);
          return (
            <Card key={p.id}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800`}>
                    <p.icon className={`h-5 w-5 ${p.color}`} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{p.label}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{account ? account.handle ?? 'Connected' : 'Not connected'}</p>
                  </div>
                </div>
                {account && <HealthBadge status={account.health_status} />}
              </div>
              {account ? (
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
                      <span className="text-slate-700 dark:text-slate-300">{formatDate(account.token_expires_at)}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500 dark:text-slate-400">Connected</span>
                    <span className="text-slate-700 dark:text-slate-300">{formatDate(account.created_at)}</span>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button size="sm" variant="outline" onClick={() => handleDisconnect(account)}>Disconnect</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(account.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Button size="sm" variant="outline" className="w-full" onClick={() => { setConnectForm({ ...connectForm, platform: p.id }); setShowConnect(true); }}>
                    <Link2 className="h-3.5 w-3.5" /> Connect
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {error && <ErrorState description={error} />}
      {loading && accounts.length === 0 && <p className="text-center text-sm text-slate-500">Loading…</p>}
      {!loading && accounts.length === 0 && !error && (
        <Card><EmptyState icon={<Link2 className="h-10 w-10" />} title="No accounts connected" description="Connect a social media account to start publishing." /></Card>
      )}

      <Modal
        open={showConnect}
        onClose={() => setShowConnect(false)}
        title="Connect Social Account"
        description="Enter your platform credentials to connect."
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
          <p className="text-xs text-slate-500 dark:text-slate-400">Your access token is stored encrypted and never exposed to the browser.</p>
        </div>
      </Modal>
    </div>
  );
}

function HealthBadge({ status }: { status: string }) {
  if (status === 'healthy') return <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Healthy</Badge>;
  if (status === 'warning') return <Badge variant="warning">Warning</Badge>;
  if (status === 'error') return <Badge variant="error"><XCircle className="mr-1 h-3 w-3" /> Error</Badge>;
  return <Badge>Unknown</Badge>;
}
