import { useEffect, useState, type ReactNode } from 'react';
import {
  Eye,
  EyeOff,
  Globe,
  Key,
  Monitor,
  Moon,
  Plug,
  Shield,
  Sun,
  User as UserIcon,
  Wrench,
  Send,
  Bell,
  Lock,
  Smartphone,
  Layout,
  Settings as SettingsIcon,
  Database,
  Mail,
  Clock,
  Type,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { LANGUAGES } from '@/i18n/translations';
import { Badge, Button, Card, Input } from '@/ui';
import { profileRepository } from '@/repositories/profileRepository';
import { workspaceRepository } from '@/repositories/workspaceRepository';
import { apiKeyRepository } from '@/repositories/apiKeyRepository';
import { platformCredentialsRepository, type CredentialKey, type CredentialStatus } from '@/repositories/platformCredentialsRepository';
import { supabase } from '@/services/supabase';
import { validateRequired } from '@/utils/validation';
import type { ApiKey } from '@/types/database';
import { formatDate, initials } from '@/utils/format';

type TabId = 'general' | 'profile' | 'workspace' | 'appearance' | 'language' | 'security' | 'apikeys' | 'integrations' | 'publishing' | 'notifications';

interface NavItem {
  id: TabId;
  label: string;
  icon: ReactNode;
  description: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>('general');
  const { t } = useLanguage();

  const groups: NavGroup[] = [
    {
      title: t('settings.tab.general'),
      items: [
        { id: 'general', label: t('settings.tab.general'), icon: <Layout className="h-4 w-4" />, description: 'Overview of your setup' },
        { id: 'profile', label: t('settings.tab.profile'), icon: <UserIcon className="h-4 w-4" />, description: 'Personal information' },
        { id: 'security', label: t('settings.tab.security'), icon: <Lock className="h-4 w-4" />, description: 'Password and security' },
      ],
    },
    {
      title: t('settings.tab.workspace'),
      items: [
        { id: 'workspace', label: t('settings.tab.workspace'), icon: <Shield className="h-4 w-4" />, description: 'Branding and team' },
        { id: 'integrations', label: t('settings.tab.integrations'), icon: <Plug className="h-4 w-4" />, description: 'External platforms' },
        { id: 'apikeys', label: t('settings.tab.apikeys'), icon: <Key className="h-4 w-4" />, description: 'Developer access' },
      ],
    },
    {
      title: t('settings.tab.appearance'),
      items: [
        { id: 'appearance', label: t('settings.tab.appearance'), icon: <Monitor className="h-4 w-4" />, description: 'Theme and visuals' },
        { id: 'language', label: t('settings.tab.language'), icon: <Globe className="h-4 w-4" />, description: 'App language' },
        { id: 'notifications', label: t('settings.tab.notifications'), icon: <Bell className="h-4 w-4" />, description: 'Alert preferences' },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-8 lg:flex-row">
      {/* Sidebar Navigation */}
      <aside className="w-full lg:w-64 lg:shrink-0">
        <div className="sticky top-6 space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('settings.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('settings.subtitle')}</p>
          </div>

          <nav className="space-y-6">
            {groups.map((group) => (
              <div key={group.title} className="space-y-1">
                <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.title}
                </h3>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setTab(item.id)}
                      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                        tab === item.id
                          ? 'bg-slate-900 text-white shadow-sm dark:bg-white dark:text-slate-900'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      <span className={`${tab === item.id ? '' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300'}`}>
                        {item.icon}
                      </span>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="min-w-0 flex-1 space-y-6">
        <div className="rounded-2xl bg-white p-1 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div className="p-6">
            {tab === 'general' && <GeneralTab />}
            {tab === 'profile' && <ProfileTab />}
            {tab === 'workspace' && <WorkspaceTab />}
            {tab === 'appearance' && <AppearanceTab />}
            {tab === 'language' && <LanguageTab />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'apikeys' && <ApiKeysTab />}
            {tab === 'integrations' && <IntegrationsTab />}
            {tab === 'notifications' && (
              <div className="py-12 text-center">
                <Bell className="mx-auto h-12 w-12 text-slate-300" />
                <h3 className="mt-4 text-lg font-medium text-slate-900 dark:text-white">{t('settings.tab.notifications')}</h3>
                <p className="mt-2 text-sm text-slate-500">Coming soon in the next update.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function GeneralTab() {
  const { user, profile } = useAuth();
  const { workspace } = useWorkspace();
  const { t } = useLanguage();

  const stats = [
    { label: t('settings.general.email'), value: user?.email, icon: <Mail className="h-4 w-4" /> },
    { label: t('settings.general.fullName'), value: profile?.full_name, icon: <UserIcon className="h-4 w-4" /> },
    { label: t('settings.workspace.name'), value: workspace?.name, icon: <Shield className="h-4 w-4" /> },
    { label: t('settings.workspace.timezone'), value: workspace?.timezone, icon: <Clock className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('settings.general.title')}</h2>
        <p className="text-sm text-slate-500">{t('settings.general.description')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {stats.map((stat) => (
          <div key={stat.label} className="flex items-start gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-600 shadow-sm dark:bg-slate-800 dark:text-slate-400">
              {stat.icon}
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{stat.label}</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{stat.value || '—'}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-6 dark:border-blue-900/30 dark:bg-blue-900/10">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-semibold text-blue-900 dark:text-blue-200">Account Verified</h3>
            <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
              Your account is active and you have access to all social pilot features. 
              Manage your workspace and branding from the sidebar.
            </p>
          </div>
        </div>
      </div>
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
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('settings.profile.title')}</h2>
        <p className="text-sm text-slate-500">{t('settings.profile.description')}</p>
      </div>

      <div className="flex flex-col items-center gap-6 sm:flex-row">
        <div className="relative">
          <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-100 text-2xl font-bold text-slate-400 ring-4 ring-white dark:bg-slate-800 dark:ring-slate-900">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="h-full w-full rounded-2xl object-cover" />
            ) : (
              initials(fullName || user?.email)
            )}
          </div>
          <div className="absolute -bottom-2 -right-2 rounded-full bg-white p-1.5 shadow-lg dark:bg-slate-800">
            <div className="rounded-full bg-slate-900 p-1 text-white dark:bg-white dark:text-slate-900">
              <UserIcon className="h-3 w-3" />
            </div>
          </div>
        </div>
        <div className="text-center sm:text-left">
          <h3 className="font-semibold text-slate-900 dark:text-white">{user?.email}</h3>
          <p className="text-sm text-slate-500">{t('settings.profile.avatarHint')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Input 
          label={t('settings.profile.fullName')} 
          value={fullName} 
          onChange={(e) => setFullName(e.target.value)} 
          placeholder={t('auth.fullNamePlaceholder')} 
        />
        <Input
          label={t('settings.profile.avatarUrl')}
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://images.unsplash.com/..."
          hint={t('settings.profile.avatarUrlHint')}
        />
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={handleSave} loading={loading} className="px-8">
          {t('settings.profile.saveChanges')}
        </Button>
      </div>
    </div>
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
        timezone,
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
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('settings.workspace.title')}</h2>
        <p className="text-sm text-slate-500">{t('settings.workspace.description')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Input label={t('settings.workspace.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Workspace" />
        <Input label={t('settings.workspace.brandName')} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Acme Inc." />
        <Input label={t('settings.workspace.logoUrl')} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
        
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.workspace.timezone')}</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 transition-all focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/5 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-white dark:focus:ring-white/5"
          >
            {['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Asia/Kolkata'].map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.workspace.contentLanguage')}</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 transition-all focus:border-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/5 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-white dark:focus:ring-white/5"
          >
            {[
              { code: 'en', label: 'English' },
              { code: 'de', label: 'German' },
              { code: 'pt', label: 'Portuguese' },
              { code: 'hi', label: 'Hindi' },
            ].map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <Button onClick={handleSave} loading={loading} className="px-8">
          {t('settings.workspace.saveChanges')}
        </Button>
      </div>
    </div>
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
    { id: 'light' as const, label: t('settings.appearance.light'), icon: <Sun className="h-6 w-6" />, desc: 'Clean and bright' },
    { id: 'dark' as const, label: t('settings.appearance.dark'), icon: <Moon className="h-6 w-6" />, desc: 'Easy on the eyes' },
    { id: 'system' as const, label: t('settings.appearance.system'), icon: <Monitor className="h-6 w-6" />, desc: 'Match your device' },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('settings.appearance.title')}</h2>
        <p className="text-sm text-slate-500">{t('settings.appearance.description')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => apply(opt.id)}
            className={`flex flex-col items-center gap-4 rounded-2xl border p-6 text-center transition-all ${
              theme === opt.id
                ? 'border-slate-900 bg-slate-50 ring-4 ring-slate-900/5 dark:border-white dark:bg-slate-800 dark:ring-white/5'
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/50'
            }`}
          >
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              theme === opt.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
            }`}>
              {opt.icon}
            </div>
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">{opt.label}</p>
              <p className="mt-1 text-xs text-slate-500">{opt.desc}</p>
            </div>
          </button>
        ))}
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
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('settings.language.title')}</h2>
        <p className="text-sm text-slate-500">{t('settings.language.description')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => apply(lang.code)}
            className={`flex items-center gap-4 rounded-2xl border p-6 transition-all ${
              language === lang.code
                ? 'border-slate-900 bg-slate-50 ring-4 ring-slate-900/5 dark:border-white dark:bg-slate-800 dark:ring-white/5'
                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/50'
            }`}
          >
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              language === lang.code ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
            }`}>
              <Globe className="h-6 w-6" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-slate-900 dark:text-white">{lang.nativeLabel}</p>
              <p className="text-xs text-slate-500">{lang.label}</p>
            </div>
            {language === lang.code && <CheckCircle2 className="ml-auto h-5 w-5 text-slate-900 dark:text-white" />}
          </button>
        ))}
      </div>
    </div>
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
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('settings.security.changePassword')}</h2>
        <p className="text-sm text-slate-500">{t('settings.security.changePasswordDesc')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Input
          label={t('settings.security.currentPassword')}
          type={show ? 'text' : 'password'}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="••••••••"
        />
        <div className="hidden sm:block" />
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
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 pt-6 dark:border-slate-800">
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {show ? t('settings.security.hidePasswords') : t('settings.security.showPasswords')}
        </button>
        <Button onClick={handleChange} loading={loading} className="px-8">
          {t('settings.security.updatePassword')}
        </Button>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-6 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm dark:bg-slate-800">
              <Smartphone className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Active Session</p>
              <p className="text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>
          <Badge variant="success">Current</Badge>
        </div>
      </div>
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
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('settings.apikeys.title')}</h2>
        <p className="text-sm text-slate-500">{t('settings.apikeys.description')}</p>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-6 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
        <p className="mt-4 text-xs text-slate-500">{t('settings.apikeys.note')}</p>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t('settings.apikeys.storedKeys')}</h3>
        {loading ? (
          <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            <p className="text-sm text-slate-500">{t('common.loading')}</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            <Database className="h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">{t('settings.apikeys.none')}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    <Key className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{k.label}</p>
                    <p className="font-mono text-xs text-slate-500">{k.masked_value}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs text-slate-500">{formatDate(k.created_at)}</p>
                    <Badge variant={k.status === 'active' ? 'success' : 'error'}>{k.status}</Badge>
                  </div>
                  {k.status === 'active' && (
                    <Button size="sm" variant="ghost" onClick={() => handleRevoke(k.id)} className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-900/20">
                      {t('settings.apikeys.revoke')}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{t('settings.tab.integrations')}</h2>
        <p className="text-sm text-slate-500">Configure your connections with social platforms.</p>
      </div>

      <div className="grid gap-6">
        {/* Meta Section */}
        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
              <Share2 className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t('settings.integrations.meta.title')}</h3>
              <p className="text-xs text-slate-500">Facebook & Instagram connectivity</p>
            </div>
          </div>
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'meta').map(renderField)}
            <Button onClick={() => saveGroup('meta')} loading={savingGroup === 'meta'} className="w-full sm:w-auto">
              {t('settings.integrations.meta.save')}
            </Button>
          </div>
        </div>

        {/* LinkedIn Section */}
        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400">
              <Plug className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t('settings.integrations.linkedin.title')}</h3>
              <p className="text-xs text-slate-500">Professional network connectivity</p>
            </div>
          </div>
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'linkedin').map(renderField)}
            <Button onClick={() => saveGroup('linkedin')} loading={savingGroup === 'linkedin'} className="w-full sm:w-auto">
              {t('settings.integrations.linkedin.save')}
            </Button>
          </div>
        </div>

        {/* App URL Section */}
        <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <Globe className="h-6 w-6" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">{t('settings.integrations.appUrl.title')}</h3>
              <p className="text-xs text-slate-500">Redirect URI configuration</p>
            </div>
          </div>
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'general').map(renderField)}
            <Button onClick={() => saveGroup('general')} loading={savingGroup === 'general'} className="w-full sm:w-auto">
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
