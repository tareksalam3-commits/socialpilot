import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, Card, Input } from '@/ui';
import { platformCredentialsRepository, type CredentialKey, type CredentialStatus } from '@/repositories/platformCredentialsRepository';

const CREDENTIAL_FIELDS: { key: CredentialKey; label: string; placeholder: string; secret: boolean; group: 'meta' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'general' }[] = [
  { key: 'meta_app_id', label: 'Meta App ID', placeholder: 'e.g. 1234567890123456', secret: false, group: 'meta' },
  { key: 'meta_app_secret', label: 'Meta App Secret', placeholder: 'Paste the app secret from Meta for Developers', secret: true, group: 'meta' },
  { key: 'meta_config_id', label: 'Meta Login Configuration ID (only if using Facebook Login for Business)', placeholder: 'e.g. 123456789012345', secret: false, group: 'meta' },
  { key: 'linkedin_client_id', label: 'LinkedIn Client ID', placeholder: 'e.g. 86abcxyz12345', secret: false, group: 'linkedin' },
  { key: 'linkedin_client_secret', label: 'LinkedIn Client Secret', placeholder: 'Paste the client secret from the LinkedIn app', secret: true, group: 'linkedin' },
  { key: 'x_client_id', label: 'X (Twitter) Client ID', placeholder: 'From the X Developer Portal', secret: false, group: 'x' },
  { key: 'x_client_secret', label: 'X (Twitter) Client Secret (confidential clients only)', placeholder: 'Leave blank for a public/PKCE-only client', secret: true, group: 'x' },
  { key: 'threads_app_id', label: 'Threads App ID', placeholder: 'From Meta for Developers (Threads use case)', secret: false, group: 'threads' },
  { key: 'threads_app_secret', label: 'Threads App Secret', placeholder: 'Paste the app secret', secret: true, group: 'threads' },
  { key: 'tiktok_client_key', label: 'TikTok Client Key', placeholder: 'From TikTok for Developers', secret: false, group: 'tiktok' },
  { key: 'tiktok_client_secret', label: 'TikTok Client Secret', placeholder: 'Paste the client secret', secret: true, group: 'tiktok' },
  { key: 'app_url', label: 'App URL', placeholder: 'https://your-app-domain.com', secret: false, group: 'general' },
];

export function AdminIntegrationsPage() {
  const { push } = useToast();
  const { t } = useLanguage();
  const [status, setStatus] = useState<Record<CredentialKey, CredentialStatus> | null>(null);
  const [values, setValues] = useState<Partial<Record<CredentialKey, string>>>({});
  const [reveal, setReveal] = useState<Partial<Record<CredentialKey, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [savingGroup, setSavingGroup] = useState<'meta' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'general' | null>(null);

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

  const saveGroup = async (group: 'meta' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'general') => {
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
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.integrations.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.integrations.subtitle')}</p>
      </div>

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

      <Card title={t('settings.integrations.x.title')} description={t('settings.integrations.x.description')}>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'x').map(renderField)}
            <Button onClick={() => saveGroup('x')} loading={savingGroup === 'x'}>{t('settings.integrations.x.save')}</Button>
          </div>
        )}
      </Card>

      <Card title={t('settings.integrations.threads.title')} description={t('settings.integrations.threads.description')}>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'threads').map(renderField)}
            <Button onClick={() => saveGroup('threads')} loading={savingGroup === 'threads'}>{t('settings.integrations.threads.save')}</Button>
          </div>
        )}
      </Card>

      <Card title={t('settings.integrations.tiktok.title')} description={t('settings.integrations.tiktok.description')}>
        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4">
            {CREDENTIAL_FIELDS.filter((f) => f.group === 'tiktok').map(renderField)}
            <Button onClick={() => saveGroup('tiktok')} loading={savingGroup === 'tiktok'}>{t('settings.integrations.tiktok.save')}</Button>
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
