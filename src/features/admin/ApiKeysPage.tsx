import { useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ErrorState, Input, Skeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { adminApiKeysRepository, type PlatformKeyName, type PlatformKeyStatus } from '@/repositories/admin/adminApiKeysRepository';

const KEYS: { name: PlatformKeyName; label: string }[] = [
  { name: 'openai_api_key', label: 'OpenAI' },
  { name: 'anthropic_api_key', label: 'Anthropic' },
  { name: 'openrouter_api_key', label: 'OpenRouter' },
  { name: 'google_ai_api_key', label: 'Google AI' },
];

export function ApiKeysPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const [status, setStatus] = useState<Record<string, PlatformKeyStatus> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    adminApiKeysRepository
      .list()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load API keys'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async (name: PlatformKeyName) => {
    const value = drafts[name]?.trim();
    if (!value) return;
    setSavingKey(name);
    try {
      await adminApiKeysRepository.save({ [name]: value });
      push({ title: t('admin.apiKeys.toast.saved'), variant: 'success' });
      setDrafts({ ...drafts, [name]: '' });
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSavingKey(null);
    }
  };

  const remove = async (name: PlatformKeyName) => {
    setSavingKey(name);
    try {
      await adminApiKeysRepository.remove(name);
      push({ title: t('admin.apiKeys.toast.removed'), variant: 'success' });
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.apiKeys.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.apiKeys.subtitle')}</p>
      </div>

      {error && <ErrorState description={error} onRetry={load} />}

      {loading && !error && (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="h-10 w-full" />
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && status && (
        <div className="space-y-4">
          {KEYS.map(({ name, label }) => {
            const s = status[name];
            return (
              <Card key={name}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                      <KeyRound className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{label}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {s?.configured ? s.masked : t('admin.apiKeys.notConfigured')}
                      </p>
                    </div>
                  </div>
                  <Badge variant={s?.configured ? 'success' : 'default'} dot>
                    {s?.configured ? t('admin.apiKeys.configured') : t('admin.apiKeys.missing')}
                  </Badge>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    placeholder={t('admin.apiKeys.field.placeholder')}
                    value={drafts[name] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [name]: e.target.value })}
                    className="max-w-sm"
                  />
                  <Button size="sm" onClick={() => save(name)} loading={savingKey === name} disabled={!drafts[name]?.trim()}>
                    {t('common.save')}
                  </Button>
                  {s?.configured && (
                    <Button size="sm" variant="ghost" onClick={() => remove(name)} disabled={savingKey === name}>
                      <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
