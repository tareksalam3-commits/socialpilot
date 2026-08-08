import { useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff, Globe, Monitor, Moon, Shield, Sun, User as UserIcon, Wrench } from 'lucide-react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { useTheme } from '@/providers/ThemeProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { LANGUAGES } from '@/i18n/translations';
import { Badge, Button, Card, Input, Tabs } from '@/ui';
import { profileRepository } from '@/repositories/profileRepository';
import { workspaceRepository } from '@/repositories/workspaceRepository';
import { supabase } from '@/services/supabase';
import { validateRequired } from '@/utils/validation';
import { formatDate, initials } from '@/utils/format';

type TabId = 'general' | 'profile' | 'workspace' | 'appearance' | 'language' | 'security';

export function SettingsPage() {
  const [tab, setTab] = useState<TabId>('general');
  const { t } = useLanguage();
  // Platform-wide social integration credentials live in the Super Admin
  // panel (/admin/integrations) exclusively — not shown here even to a
  // super admin who also owns a workspace, keeping the two panels separate.

  const items: Record<TabId, { label: string; icon: ReactNode }> = {
    general: { label: t('settings.tab.general'), icon: <Wrench className="h-4 w-4" /> },
    profile: { label: t('settings.tab.profile'), icon: <UserIcon className="h-4 w-4" /> },
    workspace: { label: t('settings.tab.workspace'), icon: <Shield className="h-4 w-4" /> },
    appearance: { label: t('settings.tab.appearance'), icon: <Monitor className="h-4 w-4" /> },
    language: { label: t('settings.tab.language'), icon: <Globe className="h-4 w-4" /> },
    security: { label: t('settings.tab.security'), icon: <Shield className="h-4 w-4" /> },
  };

  const groups: { title: string; tabs: TabId[] }[] = [
    { title: t('settings.group.workspace'), tabs: ['general', 'workspace', 'language'] },
    { title: t('settings.group.account'), tabs: ['profile', 'security'] },
    { title: t('settings.group.appearance'), tabs: ['appearance'] },
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
        <Input label={t('settings.workspace.name')} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('settings.workspace.namePlaceholder')} />
        <Input label={t('settings.workspace.brandName')} value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder={t('settings.workspace.brandNamePlaceholder')} />
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
            placeholder={t('settings.password.newPlaceholder')}
          />
          <Input
            label={t('settings.security.confirmNewPassword')}
            type={show ? 'text' : 'password'}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t('settings.password.confirmPlaceholder')}
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
