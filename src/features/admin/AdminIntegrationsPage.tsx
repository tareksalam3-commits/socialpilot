import { useEffect, useState } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, Card, Input } from '@/ui';
import { platformCredentialsRepository, type CredentialKey, type CredentialStatus } from '@/repositories/platformCredentialsRepository';

type CredentialFieldDef = { key: CredentialKey; labelKey: string; placeholderKey: string; secret: boolean; group: 'meta' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'general' };

const CREDENTIAL_FIELDS: CredentialFieldDef[] = [
  { key: 'meta_app_id', labelKey: 'admin.integrations.field.metaAppId.label', placeholderKey: 'admin.integrations.field.metaAppId.placeholder', secret: false, group: 'meta' },
  { key: 'meta_app_secret', labelKey: 'admin.integrations.field.metaAppSecret.label', placeholderKey: 'admin.integrations.field.metaAppSecret.placeholder', secret: true, group: 'meta' },
  { key: 'meta_config_id', labelKey: 'admin.integrations.field.metaConfigId.label', placeholderKey: 'admin.integrations.field.metaConfigId.placeholder', secret: false, group: 'meta' },
  { key: 'linkedin_client_id', labelKey: 'admin.integrations.field.linkedinClientId.label', placeholderKey: 'admin.integrations.field.linkedinClientId.placeholder', secret: false, group: 'linkedin' },
  { key: 'linkedin_client_secret', labelKey: 'admin.integrations.field.linkedinClientSecret.label', placeholderKey: 'admin.integrations.field.linkedinClientSecret.placeholder', secret: true, group: 'linkedin' },
  { key: 'x_client_id', labelKey: 'admin.integrations.field.xClientId.label', placeholderKey: 'admin.integrations.field.xClientId.placeholder', secret: false, group: 'x' },
  { key: 'x_client_secret', labelKey: 'admin.integrations.field.xClientSecret.label', placeholderKey: 'admin.integrations.field.xClientSecret.placeholder', secret: true, group: 'x' },
  { key: 'threads_app_id', labelKey: 'admin.integrations.field.threadsAppId.label', placeholderKey: 'admin.integrations.field.threadsAppId.placeholder', secret: false, group: 'threads' },
  { key: 'threads_app_secret', labelKey: 'admin.integrations.field.threadsAppSecret.label', placeholderKey: 'admin.integrations.field.threadsAppSecret.placeholder', secret: true, group: 'threads' },
  { key: 'tiktok_client_key', labelKey: 'admin.integrations.field.tiktokClientKey.label', placeholderKey: 'admin.integrations.field.tiktokClientKey.placeholder', secret: false, group: 'tiktok' },
  { key: 'tiktok_client_secret', labelKey: 'admin.integrations.field.tiktokClientSecret.label', placeholderKey: 'admin.integrations.field.tiktokClientSecret.placeholder', secret: true, group: 'tiktok' },
  { key: 'app_url', labelKey: 'admin.integrations.field.appUrl.label', placeholderKey: 'admin.integrations.field.appUrl.placeholder', secret: false, group: 'general' },
];

export function AdminIntegrationsPage() {
  const { push } = useToast();
  const { t } = useLanguage();
  const [status, setStatus] = useState<Record<CredentialKey, CredentialStatus> | null>(null);
  const [values, setValues] = useState<Partial<Record<CredentialKey, string>>>({});
  const [reveal, setReveal] = useState<Partial<Record<CredentialKey, boolean>>>({});
  const [loading, setLoading] = useState(true);
  const [savingGroup, setSavingGroup] = useState<'meta' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'general' | null>(null);
  const [copied, setCopied] = useState<'terms' | 'privacy' | null>(null);

  // Built from the current origin so the URLs always match whichever domain
  // is actually serving the app (production or a Vercel preview deploy),
  // rather than depending on the separately-configured app_url setting.
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const termsUrl = `${origin}/terms`;
  const privacyUrl = `${origin}/privacy`;

  const copyToClipboard = async (kind: 'terms' | 'privacy', value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard API can fail silently (e.g. insecure context); no-op.
    }
  };

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

  const renderField = (f: CredentialFieldDef) => {
    const configured = status?.[f.key]?.configured;
    return (
      <div key={f.key} className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{t(f.labelKey)}</label>
          {configured && <Badge variant="success">{t('settings.integrations.configured')}</Badge>}
        </div>
        <div className="relative">
          <Input
            type={f.secret && !reveal[f.key] ? 'password' : 'text'}
            value={values[f.key] ?? ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
            placeholder={configured ? t('settings.integrations.alreadySet') : t(f.placeholderKey)}
            className={f.secret ? 'pe-10' : undefined}
          />
          {f.secret && (
            <button
              type="button"
              onClick={() => setReveal((prev) => ({ ...prev, [f.key]: !prev[f.key] }))}
              className="absolute end-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
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

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('settings.integrations.tiktok.legalUrls.title')}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {t('settings.integrations.tiktok.legalUrls.description')}
              </p>
              <div className="mt-3 space-y-2">
                {([
                  ['terms', termsUrl, t('settings.integrations.tiktok.legalUrls.terms')],
                  ['privacy', privacyUrl, t('settings.integrations.tiktok.legalUrls.privacy')],
                ] as const).map(([kind, url, label]) => (
                  <div key={kind} className="space-y-1">
                    <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
                    <div className="flex items-center gap-2">
                      <Input readOnly value={url} className="font-mono text-xs" />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(kind, url)}
                        aria-label={t('settings.integrations.tiktok.legalUrls.copy')}
                      >
                        {copied === kind ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
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
