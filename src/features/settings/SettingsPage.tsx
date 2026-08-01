import { useEffect, useState } from 'react';
import { Eye, EyeOff, Key, Monitor, Moon, Shield, Sun, User as UserIcon, Wrench, Send, Bell } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { Badge, Button, Card, Input, Tabs } from '@/ui';
import { profileRepository } from '@/repositories/profileRepository';
import { workspaceRepository } from '@/repositories/workspaceRepository';
import { apiKeyRepository } from '@/repositories/apiKeyRepository';
import { supabase } from '@/services/supabase';
import { validateRequired } from '@/utils/validation';
import type { ApiKey } from '@/types/database';
import { formatDate, initials } from '@/utils/format';

type TabId = 'general' | 'profile' | 'workspace' | 'appearance' | 'security' | 'apikeys' | 'publishing' | 'notifications';

const tabs = [
  { id: 'general' as TabId, label: 'General', icon: <Wrench className="h-4 w-4" /> },
  { id: 'profile' as TabId, label: 'Profile', icon: <UserIcon className="h-4 w-4" /> },
  { id: 'workspace' as TabId, label: 'Workspace', icon: <Shield className="h-4 w-4" /> },
  { id: 'appearance' as TabId, label: 'Appearance', icon: <Monitor className="h-4 w-4" /> },
  { id: 'publishing' as TabId, label: 'Publishing', icon: <Send className="h-4 w-4" /> },
  { id: 'notifications' as TabId, label: 'Notifications', icon: <Bell className="h-4 w-4" /> },
  { id: 'security' as TabId, label: 'Security', icon: <Shield className="h-4 w-4" /> },
  { id: 'apikeys' as TabId, label: 'API Keys', icon: <Key className="h-4 w-4" /> },
];

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>('general');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage your account, workspace, and preferences.</p>
      </div>
      <Tabs tabs={tabs} active={tab} onChange={(t) => setTab(t as TabId)} />
      <div>
        {tab === 'general' && <GeneralTab />}
        {tab === 'profile' && <ProfileTab />}
        {tab === 'workspace' && <WorkspaceTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'security' && <SecurityTab />}
        {tab === 'apikeys' && <ApiKeysTab />}
      </div>
    </div>
  );
}

function GeneralTab() {
  const { profile } = useAuth();
  const { workspace } = useWorkspace();
  return (
    <Card title="General Information" description="Overview of your account and workspace">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Info label="Account email" value={profile ? '—' : '—'} />
        <Info label="Full name" value={profile?.full_name ?? 'Not set'} />
        <Info label="Workspace" value={workspace?.name ?? 'Not set'} />
        <Info label="Brand name" value={workspace?.brand_name ?? 'Not set'} />
        <Info label="Time zone" value={workspace?.timezone ?? 'UTC'} />
        <Info label="Language" value={workspace?.language ?? 'en'} />
      </dl>
    </Card>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{value}</dd>
    </div>
  );
}

function ProfileTab() {
  const { user, profile, refreshProfile } = useAuth();
  const { push } = useToast();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const nameErr = validateRequired(fullName, 'Full name');
    if (!nameErr.valid) {
      push({ title: 'Validation error', description: nameErr.error!, variant: 'error' });
      return;
    }
    setLoading(true);
    try {
      await profileRepository.update(user!.id, { full_name: fullName, avatar_url: avatarUrl || null });
      await refreshProfile();
      push({ title: 'Profile updated', variant: 'success' });
    } catch (e) {
      push({ title: 'Update failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Profile" description="Update your personal information">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-lg font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {initials(fullName || user?.email)}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">{user?.email}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Your avatar appears across the app</p>
        </div>
      </div>
      <div className="mt-6 space-y-4">
        <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Jane Doe" />
        <Input
          label="Avatar URL"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://…"
          hint="Paste a link to your profile picture"
        />
        <div className="flex justify-end">
          <Button onClick={handleSave} loading={loading}>
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}

function WorkspaceTab() {
  const { workspace, refresh } = useWorkspace();
  const { push } = useToast();
  const [name, setName] = useState(workspace?.name ?? '');
  const [brandName, setBrandName] = useState(workspace?.brand_name ?? '');
  const [logoUrl, setLogoUrl] = useState(workspace?.logo_url ?? '');
  const [timezone, setTimezone] = useState(workspace?.timezone ?? 'UTC');
  const [language, setLanguage] = useState(workspace?.language ?? 'en');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const nameErr = validateRequired(name, 'Workspace name');
    if (!nameErr.valid) {
      push({ title: 'Validation error', description: nameErr.error!, variant: 'error' });
      return;
    }
    if (!workspace) return;
    setLoading(true);
    try {
      await workspaceRepository.update(workspace.id, {
        name,
        brand_name: brandName || null,
        logo_url: logoUrl || null,
        timezone,
        language,
      });
      await refresh();
      push({ title: 'Workspace updated', variant: 'success' });
    } catch (e) {
      push({ title: 'Update failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Workspace" description="Manage your workspace and brand settings">
      <div className="space-y-4">
        <Input label="Workspace name" value={name} onChange={(e) => setName(e.target.value)} placeholder="My Workspace" />
        <Input label="Brand name" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Acme Inc." />
        <Input label="Logo URL" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Time zone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Kolkata'].map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Language</label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {[
                { code: 'en', label: 'English' },
                { code: 'es', label: 'Spanish' },
                { code: 'fr', label: 'French' },
                { code: 'de', label: 'German' },
                { code: 'pt', label: 'Portuguese' },
                { code: 'hi', label: 'Hindi' },
              ].map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleSave} loading={loading}>
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { push } = useToast();
  const { profile, refreshProfile } = useAuth();

  const apply = async (t: 'light' | 'dark' | 'system') => {
    setTheme(t);
    if (profile) {
      try {
        await profileRepository.update(profile.user_id, { theme: t });
        await refreshProfile();
        push({ title: 'Theme saved', variant: 'success' });
      } catch {
        // theme still applies locally
      }
    }
  };

  const options = [
    { id: 'light' as const, label: 'Light', icon: <Sun className="h-5 w-5" /> },
    { id: 'dark' as const, label: 'Dark', icon: <Moon className="h-5 w-5" /> },
    { id: 'system' as const, label: 'System', icon: <Monitor className="h-5 w-5" /> },
  ];

  return (
    <Card title="Appearance" description="Choose how SocialPilot AI looks to you">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => apply(opt.id)}
            className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition ${
              theme === opt.id
                ? 'border-slate-900 bg-slate-50 dark:border-white dark:bg-slate-800'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
            }`}
          >
            <span className="text-slate-700 dark:text-slate-300">{opt.icon}</span>
            <span className="text-sm font-medium text-slate-900 dark:text-white">{opt.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function SecurityTab() {
  const { user } = useAuth();
  const { push } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (next.length < 6) {
      push({ title: 'Password too short', description: 'Use at least 6 characters.', variant: 'error' });
      return;
    }
    if (next !== confirm) {
      push({ title: 'Passwords do not match', variant: 'error' });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: next });
    setLoading(false);
    if (error) {
      push({ title: 'Update failed', description: error.message, variant: 'error' });
      return;
    }
    push({ title: 'Password updated', variant: 'success' });
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  return (
    <div className="space-y-6">
      <Card title="Change Password" description="Update your account password">
        <div className="space-y-4">
          <Input
            label="Current password"
            type={show ? 'text' : 'password'}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="••••••••"
          />
          <Input
            label="New password"
            type={show ? 'text' : 'password'}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="At least 6 characters"
          />
          <Input
            label="Confirm new password"
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter new password"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {show ? 'Hide passwords' : 'Show passwords'}
            </button>
            <Button onClick={handleChange} loading={loading}>
              Update password
            </Button>
          </div>
        </div>
      </Card>
      <Card title="Account" description="Your account email and session">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">Email</span>
            <span className="text-sm font-medium text-slate-900 dark:text-white">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">User ID</span>
            <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{user?.id}</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ApiKeysTab() {
  const { workspace } = useWorkspace();
  const { push } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    if (!workspace) return;
    try {
      setLoading(true);
      const data = await apiKeyRepository.list(workspace.id);
      setKeys(data);
    } catch (e) {
      push({ title: 'Failed to load keys', description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  // load on mount / when workspace changes
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const handleCreate = async () => {
    const labelErr = validateRequired(label, 'Label');
    const valueErr = validateRequired(value, 'API key value');
    if (!labelErr.valid || !valueErr.valid) {
      push({ title: 'Validation error', description: labelErr.error ?? valueErr.error ?? '', variant: 'error' });
      return;
    }
    if (!workspace) return;
    setCreating(true);
    try {
      const masked = value.length > 8 ? `${value.slice(0, 4)}••••${value.slice(-4)}` : '••••';
      const created = await apiKeyRepository.create({
        workspace_id: workspace.id,
        label,
        masked_value: masked,
      });
      setKeys((prev) => [created, ...prev]);
      setLabel('');
      setValue('');
      push({ title: 'API key added', variant: 'success' });
    } catch (e) {
      push({ title: 'Failed to add key', description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apiKeyRepository.revoke(id);
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, status: 'revoked' } : k)));
      push({ title: 'Key revoked', variant: 'success' });
    } catch (e) {
      push({ title: 'Failed to revoke', description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <Card title="API Keys" description="Prepare integrations with third-party services (keys are stored masked)">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="OpenAI" />
            <Input
              label="Key value"
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-…"
            />
            <div className="flex items-end">
              <Button onClick={handleCreate} loading={creating} className="w-full">
                Add key
              </Button>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Keys are stored masked and never displayed in full. This is a preparation step for future integrations.
          </p>
        </div>
      </Card>

      <Card title="Stored Keys">
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No API keys stored yet.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <div
                key={k.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-800"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">{k.label}</p>
                  <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{k.masked_value}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(k.created_at)}</span>
                  <Badge variant={k.status === 'active' ? 'success' : 'error'}>{k.status}</Badge>
                  {k.status === 'active' && (
                    <Button size="sm" variant="ghost" onClick={() => handleRevoke(k.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
