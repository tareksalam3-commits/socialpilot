import { useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Globe, Key, Monitor, Moon, Plug, Shield, Sun, User as UserIcon, Wrench } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { LANGUAGES } from '@/i18n/translations';
import { Badge, Button, Card, Input, Tabs } from '@/ui';
import { profileRepository } from '@/repositories/profileRepository';
import { workspaceRepository } from '@/repositories/workspaceRepository';
import { apiKeyRepository } from '@/repositories/apiKeyRepository';
import { platformCredentialsRepository, type CredentialKey, type CredentialStatus } from '@/repositories/platformCredentialsRepository';
import { supabase } from '@/services/supabase';
import { validateRequired } from '@/utils/validation';
import type { ApiKey } from '@/types/database';
import { formatDate, initials } from '@/utils/format';

type TabId = 'general' | 'profile' | 'workspace' | 'appearance' | 'language' | 'security' | 'apikeys' | 'integrations';

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>('general');
  const { t } = useLanguage();

  const items: Record<TabId, { label: string; icon: ReactNode }> = {
    general: { label: t('settings.tab.general'), icon: <Wrench className="h-4 w-4" /> },
    profile: { label: t('settings.tab.profile'), icon: <UserIcon className="h-4 w-4" /> },
    workspace: { label: t('settings.tab.workspace'), icon: <Shield className="h-4 w-4" /> },
    appearance: { label: t('settings.tab.appearance'), icon: <Monitor className="h-4 w-4" /> },
    language: { label: t('settings.tab.language'), icon: <Globe className="h-4 w-4" /> },
    integrations: { label: t('settings.tab.integrations'), icon: <Plug className="h-4 w-4" /> },
    security: { label: t('settings.tab.security'), icon: <Shield className="h-4 w-4" /> },
    apikeys: { label: t('settings.tab.apikeys'), icon: <Key className="h-4 w-4" /> },
  };

  const groups: { title: string; tabs: TabId[] }[] = [
    { title: t('settings.group.workspace'), tabs: ['general', 'workspace', 'language'] },
    { title: t('settings.group.account'), tabs: ['profile', 'security', 'apikeys'] },
    { title: t('settings.group.appearance'), tabs: ['appearance'] },
    { title: t('settings.group.publishing'), tabs: ['integrations'] },
  ];

  const flatTabs = groups.flatMap((g) => g.tabs).map((id) => ({ id, label: items[id].label, icon: items[id].icon }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('settings.subtitle')}</p>
      </div>

      {/* Mobile / narrow screens: horizontal scrollable tabs */}
      <div className="lg:hidden">
        <Tabs tabs={flatTabs} active={tab} onChange={(id) => setTab(id as TabId)} />
      </div>

      <div className="lg:flex lg:items-start lg:gap-8">
        {/* Desktop: grouped sidebar navigation */}
        <nav className="hidden w-56 shrink-0 lg:block">
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {group.title}
                </p>
                <div className="space-y-0.5">
                  {group.tabs.map((id) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                        tab === id
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
                      }`}
                    >
                      {items[id].icon}
                      {items[id].label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="min-w-0 flex-1">
          {tab === 'general' && <GeneralTab />}
          {tab === 'profile' && <ProfileTab />}
          {tab === 'workspace' && <WorkspaceTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'language' && <LanguageTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'apikeys' && <ApiKeysTab />}
          {tab === 'integrations' && <IntegrationsTab />}
        </div>
      </div>
    </div>
  );
}

function LanguageTab() {
  const { language, setLanguage, t } = useLanguage();
  const { push } = useToast();

  const apply = (code: (typeof LANGUAGES)[number]['code']) => {
    setLanguage(code);
    push({ title: t('settings.language.title'), variant: 'success' });
  };

  return (
    <Card title={t('settings.language.title')} description={t('settings.language.description')}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => apply(lang.code)}
            className={`flex flex-col items-center gap-2 rounded-lg border p-4 transition ${
              language === lang.code
                ? 'border-slate-900 bg-slate-50 dark:border-white dark:bg-slate-800'
                : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
            }`}
          >
            <Globe className="h-5 w-5 text-slate-700 dark:text-slate-300" />
            <span className="text-sm font-medium text-slate-900 dark:text-white">{lang.nativeLabel}</span>
            <span className="text-xs text-slate-400">{lang.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function GeneralTab() {
  const { profile } = useAuth();
  const { workspace } = useWorkspace();
  const { t } = useLanguage();
  return (
    <Card title={t('settings.general.title')} description={t('settings.general.description')}>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Info label={t('settings.general.email')} value={profile ? '—' : '—'} />
        <Info label={t('settings.general.fullName')} value={profile?.full_name ?? t('settings.notSet')} />
        <Info label={t('settings.general.workspace')} value={workspace?.name ?? t('settings.notSet')} />
        <Info label={t('settings.general.brandName')} value={workspace?.brand_name ?? t('settings.notSet')} />
        <Info label={t('settings.general.language')} value={workspace?.language ?? 'ar'} />
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
  const { t } = useLanguage();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    const nameErr = validateRequired(fullName, t('settings.profile.fullName'), t);
    if (!nameErr.valid) {
      push({ title: t('settings.profile.toast.validationError'), description: nameErr.error!, variant: 'error' });
      return;
    }
    setLoading(true);
    try {
      await profileRepository.update(user!.id, { full_name: fullName, avatar_url: avatarUrl || null });
      await refreshProfile();
      push({ title: t('settings.profile.toast.updated'), variant: 'success' });
    } catch (e) {
      push({ title: t('settings.profile.toast.updateFailed'), description: e instanceof Error ? e.message : t('settings.profile.toast.unknownError'), variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title={t('settings.profile.title')} description={t('settings.profile.description')}>
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-lg font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {initials(fullName || user?.email)}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">{user?.email}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('settings.profile.avatarHint')}</p>
        </div>
      </div>
      <div className="mt-6 space-y-4">
        <Input label={t('settings.profile.fullName')} value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t('auth.fullNamePlaceholder')} />
        <Input
          label={t('settings.profile.avatarUrl')}
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://…"
          hint={t('settings.profile.avatarUrlHint')}
        />
        <div className="flex justify-end">
          <Button onClick={handleSave} loading={loading}>
            {t('settings.profile.saveChanges')}
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
  const [language, setLanguage] = useState(workspace?.language ?? 'ar');
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();

  const handleSave = async () => {
    const nameErr = validateRequired(name, t('settings.workspace.name'), t);
    if (!nameErr.valid) {
      push({ title: t('settings.workspace.toast.validationError'), description: nameErr.error!, variant: 'error' });
      return;
    }
    if (!workspace) return;
    setLoading(true);
    try {
      await workspaceRepository.update(workspace.id, {
        name,
        brand_name: brandName || null,
        logo_url: logoUrl || null,
        language,
      });
      await refresh();
      push({ title: t('settings.workspace.toast.updated'), variant: 'success' });
    } catch (e) {
      push({ title: t('settings.profile.toast.updateFailed'), description: e instanceof Error ? e.message : t('settings.profile.toast.unknownError'), variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title={t('settings.workspace.title')} description={t('settings.workspace.description')}>
      <div className="space-y-4">
        <Input label={t('settings.workspace.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Workspace" />
        <Input label={t('settings.workspace.brandName')} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Acme Inc." />
        <Input label={t('settings.workspace.logoUrl')} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.workspace.contentLanguage')}</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {[
              { code: 'ar', label: 'العربية' },
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
        <div className="flex justify-end">
          <Button onClick={handleSave} loading={loading}>
            {t('settings.workspace.saveChanges')}
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
  const { t } = useLanguage();

  const apply = async (nextTheme: 'light' | 'dark' | 'system') => {
    setTheme(nextTheme);
    if (profile) {
      try {
        await profileRepository.update(profile.user_id, { theme: nextTheme });
        await refreshProfile();
        push({ title: t('settings.appearance.toast.saved'), variant: 'success' });
      } catch {
        // theme still applies locally
      }
    }
  };

  const options = [
    { id: 'light' as const, label: t('settings.appearance.light'), icon: <Sun className="h-5 w-5" /> },
    { id: 'dark' as const, label: t('settings.appearance.dark'), icon: <Moon className="h-5 w-5" /> },
    { id: 'system' as const, label: t('settings.appearance.system'), icon: <Monitor className="h-5 w-5" /> },
  ];

  return (
    <Card title={t('settings.appearance.title')} description={t('settings.appearance.description')}>
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
  const { t } = useLanguage();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = async () => {
    if (next.length < 6) {
      push({ title: t('settings.security.toast.tooShort'), description: t('settings.security.toast.tooShortDesc'), variant: 'error' });
      return;
    }
    if (next !== confirm) {
      push({ title: t('settings.security.toast.mismatch'), variant: 'error' });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: next });
    setLoading(false);
    if (error) {
      push({ title: t('settings.security.toast.updateFailed'), description: error.message, variant: 'error' });
      return;
    }
    push({ title: t('settings.security.toast.updated'), variant: 'success' });
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  return (
    <div className="space-y-6">
      <Card title={t('settings.security.changePassword')} description={t('settings.security.changePasswordDesc')}>
        <div className="space-y-4">
          <Input
            label={t('settings.security.currentPassword')}
            type={show ? 'text' : 'password'}
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="••••••••"
          />
          <Input
            label={t('settings.security.newPassword')}
            type={show ? 'text' : 'password'}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="At least 6 characters"
          />
          <Input
            label={t('settings.security.confirmNewPassword')}
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
              {show ? t('settings.security.hidePasswords') : t('settings.security.showPasswords')}
            </button>
            <Button onClick={handleChange} loading={loading}>
              {t('settings.security.updatePassword')}
            </Button>
          </div>
        </div>
      </Card>
      <Card title={t('settings.security.account')} description={t('settings.security.accountDesc')}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('settings.security.email')}</span>
            <span className="text-sm font-medium text-slate-900 dark:text-white">{user?.email}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-500 dark:text-slate-400">{t('settings.security.userId')}</span>
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
  const { t } = useLanguage();
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
      push({ title: t('settings.apikeys.toast.loadFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
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
    const labelErr = validateRequired(label, t('settings.apikeys.label'), t);
    const valueErr = validateRequired(value, t('settings.apikeys.keyValue'), t);
    if (!labelErr.valid || !valueErr.valid) {
      push({ title: t('settings.apikeys.toast.validationError'), description: labelErr.error ?? valueErr.error ?? '', variant: 'error' });
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
      push({ title: t('settings.apikeys.toast.added'), variant: 'success' });
    } catch (e) {
      push({ title: t('settings.apikeys.toast.addFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apiKeyRepository.revoke(id);
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, status: 'revoked' } : k)));
      push({ title: t('settings.apikeys.toast.revoked'), variant: 'success' });
    } catch (e) {
      push({ title: t('settings.apikeys.toast.revokeFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <Card title={t('settings.apikeys.title')} description={t('settings.apikeys.description')}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input label={t('settings.apikeys.label')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="OpenAI" />
            <Input
              label={t('settings.apikeys.keyValue')}
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-…"
            />
            <div className="flex items-end">
              <Button onClick={handleCreate} loading={creating} className="w-full">
                {t('settings.apikeys.addKey')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t('settings.apikeys.note')}
          </p>
        </div>
      </Card>

      <Card title={t('settings.apikeys.storedKeys')}>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : keys.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('settings.apikeys.none')}</p>
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
                      {t('settings.apikeys.revoke')}
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

const CREDENTIAL_FIELDS: { key: CredentialKey; label: string; placeholder: string; secret: boolean; group: 'meta' | 'linkedin' | 'general' }[] = [
  { key: 'meta_app_id', label: 'Meta App ID', placeholder: 'e.g. 1234567890123456', secret: false, group: 'meta' },
  { key: 'meta_app_secret', label: 'Meta App Secret', placeholder: 'Paste the app secret from Meta for Developers', secret: true, group: 'meta' },
  { key: 'linkedin_client_id', label: 'LinkedIn Client ID', placeholder: 'e.g. 86abcxyz12345', secret: false, group: 'linkedin' },
  { key: 'linkedin_client_secret', label: 'LinkedIn Client Secret', placeholder: 'Paste the client secret from the LinkedIn app', secret: true, group: 'linkedin' },
  { key: 'app_url', label: 'App URL', placeholder: 'https://your-app-domain.com', secret: false, group: 'general' },
];

function IntegrationsTab() {
  const { push } = useToast();
  const { t } = useLanguage();
  const [status, setStatus] = useState<Record<CredentialKey, CredentialStatus> | null>(null);
  const [values, setValues] = useState<Partial<Record<CredentialKey, string>>>({});
  const [reveal, setReveal] = useState<Partial<Record<CredentialKey, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [savingGroup, setSavingGroup] = useState<'meta' | 'linkedin' | 'general' | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await platformCredentialsRepository.list();
      setStatus(data);
      setValues((prev) => ({ ...prev, app_url: data.app_url?.value ?? prev.app_url ?? '' }));
    } catch (e) {
      push({ title: t('settings.integrations.loadError'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveGroup = async (group: 'meta' | 'linkedin' | 'general') => {
    const fields = CREDENTIAL_FIELDS.filter((f) => f.group === group);
    const payload: Partial<Record<CredentialKey, string>> = {};
    for (const f of fields) {
      const v = values[f.key]?.trim();
      if (v) payload[f.key] = v;
    }
    if (Object.keys(payload).length === 0) {
      push({ title: t('settings.integrations.enterValue'), variant: 'error' });
      return;
    }
    setSavingGroup(group);
    try {
      await platformCredentialsRepository.save(payload);
      push({ title: t('settings.integrations.savedTitle'), description: t('settings.integrations.savedDescription'), variant: 'success' });
      setValues((prev) => {
        const next = { ...prev };
        for (const f of fields) if (f.secret) next[f.key] = '';
        return next;
      });
      await load();
    } catch (e) {
      push({ title: t('settings.integrations.saveError'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setSavingGroup(null);
    }
  };

  const renderField = (f: (typeof CREDENTIAL_FIELDS)[number]) => {
    const configured = status?.[f.key]?.configured;
    return (
      <div key={f.key} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{f.label}</label>
          {configured && <Badge variant="success">{t('settings.integrations.configured')}</Badge>}
        </div>
        <div className="relative">
          <Input
            type={f.secret && !reveal[f.key] ? 'password' : 'text'}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            placeholder={configured ? t('settings.integrations.alreadySet') : f.placeholder}
            className={f.secret ? 'pr-10' : undefined}
          />
          {f.secret && (
            <button
              type="button"
              onClick={() => setReveal((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              {reveal[f.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card
        title={t('settings.integrations.meta.title')}
        description={t('settings.integrations.meta.description')}
      >
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'meta').map(renderField)}
            <Button onClick={() => saveGroup('meta')} loading={savingGroup === 'meta'}>{t('settings.integrations.meta.save')}</Button>
          </div>
        )}
      </Card>

      <Card title={t('settings.integrations.linkedin.title')} description={t('settings.integrations.linkedin.description')}>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'linkedin').map(renderField)}
            <Button onClick={() => saveGroup('linkedin')} loading={savingGroup === 'linkedin'}>{t('settings.integrations.linkedin.save')}</Button>
          </div>
        )}
      </Card>

      <Card title={t('settings.integrations.appUrl.title')} description={t('settings.integrations.appUrl.description')}>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'general').map(renderField)}
            <Button onClick={() => saveGroup('general')} loading={savingGroup === 'general'}>{t('common.save')}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
