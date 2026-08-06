import { useEffect, useState } from 'react';
import { Card, EmptyState, ErrorState, Input, Skeleton } from '@/ui';
import { Button } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { systemSettingsRepository } from '@/repositories/admin/systemSettingsRepository';
import type { SystemSetting } from '@/types/database';

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function SystemSettingsPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const [settings, setSettings] = useState<SystemSetting[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    systemSettingsRepository
      .list()
      .then((rows) => {
        setSettings(rows);
        setDrafts(Object.fromEntries(rows.map((r) => [r.key, stringifyValue(r.value)])));
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load settings'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const save = async (key: string) => {
    setSavingKey(key);
    try {
      const raw = drafts[key];
      let value: unknown = raw;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw; // keep as plain string if it isn't valid JSON
      }
      await systemSettingsRepository.set(key, value);
      push({ title: t('admin.settings.toast.saved'), variant: 'success' });
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
        <h1 className="text-2xl font-bold text-white">{t('admin.settings.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.settings.subtitle')}</p>
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

      {!loading && !error && settings.length === 0 && <EmptyState title={t('admin.settings.empty')} />}

      {!loading && !error && settings.length > 0 && (
        <div className="space-y-4">
          {settings.map((s) => (
            <Card key={s.key} title={s.key} description={s.description ?? undefined}>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={drafts[s.key] ?? ''}
                  onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                  className="max-w-md"
                />
                <Button size="sm" onClick={() => save(s.key)} loading={savingKey === s.key}>
                  {t('common.save')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
