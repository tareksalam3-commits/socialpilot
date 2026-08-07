import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Plug, Save, Trash2, XCircle, Zap } from 'lucide-react';
import { useAISettings } from '@/hooks/useAISettings';
import { useProviderKeys } from '@/hooks/useProviderKeys';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { aiGateway } from '@/services/aiGateway';
import { Badge, Button, Card, Input, Skeleton } from '@/ui';
import type { AiProvider, ModelInfo, ProviderInfo, ProviderStatus } from '@/types/ai';

type ConnState = 'idle' | 'testing' | 'connected' | 'failed';

// Fallback shown while the live list loads from the edge function (?action=providers),
// which is the source of truth for which providers are actually wired up server-side.
const FALLBACK_PROVIDERS: ProviderInfo[] = [
  { id: 'openrouter', label: 'OpenRouter', default_model: 'openrouter/auto', supports_model_list: true },
  { id: 'groq', label: 'Groq', default_model: 'llama-3.3-70b-versatile', supports_model_list: true },
  { id: 'cerebras', label: 'Cerebras', default_model: 'llama-3.3-70b', supports_model_list: true },
  { id: 'nvidia', label: 'NVIDIA NIM', default_model: 'meta/llama-3.3-70b-instruct', supports_model_list: true },
  { id: 'mistral', label: 'Mistral', default_model: 'mistral-small-latest', supports_model_list: true },
  { id: 'zai', label: 'Z.ai', default_model: 'glm-5.2', supports_model_list: false },
];

function ProviderKeyRow({
  provider,
  status,
  onSave,
  onClear,
}: {
  provider: ProviderInfo;
  status: ProviderStatus | null;
  onSave: (provider: AiProvider, key: string) => Promise<void>;
  onClear: (provider: AiProvider) => Promise<void>;
}) {
  const { t } = useLanguage();
  const { push } = useToast();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<ConnState>('idle');

  const configured = status?.configured ?? false;

  const handleSave = async () => {
    if (!value.trim()) {
      push({ title: t('ai.settings.providers.toast.enterKey'), variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      await onSave(provider.id, value.trim());
      setValue('');
      push({ title: t('ai.settings.providers.toast.saved', { provider: provider.label }), variant: 'success' });
    } catch (e) {
      push({ title: t('ai.settings.providers.toast.saveFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestState('testing');
    try {
      await aiGateway.testConnection(provider.id);
      setTestState('connected');
      push({ title: t('ai.settings.providers.toast.testOk', { provider: provider.label }), variant: 'success' });
    } catch (e) {
      setTestState('failed');
      push({ title: t('ai.settings.providers.toast.testFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setTesting(false);
    }
  };

  const handleClear = async () => {
    try {
      await onClear(provider.id);
      push({ title: t('ai.settings.providers.toast.cleared', { provider: provider.label }), variant: 'success' });
    } catch (e) {
      push({ title: t('ai.settings.providers.toast.saveFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{provider.label}</span>
          {configured ? (
            <Badge variant="success">{t('ai.settings.providers.configured')}</Badge>
          ) : (
            <Badge>{t('ai.settings.providers.notConfigured')}</Badge>
          )}
          {testState === 'connected' && (
            <Badge variant="success"><CheckCircle2 className="me-1 h-3 w-3" /> {t('ai.settings.apiKey.connected')}</Badge>
          )}
          {testState === 'failed' && (
            <Badge variant="error"><XCircle className="me-1 h-3 w-3" /> {t('ai.settings.apiKey.failed')}</Badge>
          )}
        </div>
        <span className="font-mono text-[11px] text-slate-400">{provider.default_model}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          type="password"
          placeholder={configured ? t('ai.settings.providers.placeholderConfigured') : t('ai.settings.providers.placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-w-[220px] flex-1"
        />
        <Button size="sm" onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4" /> {t('ai.settings.apiKey.saveButton')}
        </Button>
        <Button variant="outline" size="sm" onClick={handleTest} loading={testing} disabled={!configured}>
          <Plug className="h-4 w-4" /> {t('ai.settings.apiKey.testButton')}
        </Button>
        {configured && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <Trash2 className="h-4 w-4" /> {t('ai.settings.providers.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AiProvidersPage() {
  const { t } = useLanguage();
  const { settings, loading, update } = useAISettings();
  const { loading: keysLoading, saveKey, clearKey, statusFor } = useProviderKeys();
  const { push } = useToast();

  const [providers, setProviders] = useState<ProviderInfo[]>(FALLBACK_PROVIDERS);
  const [connState, setConnState] = useState<ConnState>('idle');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    aiGateway
      .getProviders()
      .then((list) => {
        if (list.length > 0) setProviders(list);
      })
      .catch(() => {
        // keep the fallback list — the page should still be usable offline
      });
  }, []);

  const handleTest = async () => {
    setConnState('testing');
    try {
      await aiGateway.testConnection(settings?.provider);
      setConnState('connected');
      push({ title: t('ai.settings.toast.connectionSuccess'), description: t('ai.settings.toast.connectionSuccessDesc'), variant: 'success' });
    } catch (e) {
      setConnState('failed');
      push({ title: t('ai.settings.toast.connectionFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const handleLoadModels = async () => {
    setLoadingModels(true);
    try {
      const result = await aiGateway.listModels(settings?.provider);
      setModels(result.models);
      push({ title: t('ai.settings.toast.modelsLoaded'), description: t('ai.settings.toast.modelsLoadedDesc', { free: result.free_count, total: result.total_count }), variant: 'success' });
    } catch (e) {
      push({ title: t('ai.settings.toast.loadModelsFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleUpdate = async (patch: Record<string, unknown>) => {
    try {
      await update(patch);
      push({ title: t('ai.settings.toast.settingsUpdated'), variant: 'success' });
    } catch (e) {
      push({ title: t('ai.settings.toast.updateFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="rounded-xl border border-slate-200 p-5 dark:border-slate-800">
          <Skeleton className="mb-3 h-4 w-32" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  const freeModels = models.filter((m) => m.is_free);
  const isManual = (settings?.model_selection ?? 'auto') === 'manual';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.aiProviders.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.aiProviders.subtitle')}</p>
      </div>

      {/* Provider API Keys — one shared pool for the whole platform, all providers in one place */}
      <Card title={t('ai.settings.providers.title')} description={t('ai.settings.providers.description')}>
        {keysLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {providers.map((p) => (
              <ProviderKeyRow key={p.id} provider={p} status={statusFor(p.id)} onSave={saveKey} onClear={clearKey} />
            ))}
          </div>
        )}
      </Card>

      {/* Model selection mode: auto lets the gateway dynamically fall back
          across every configured provider/model (as it already does under
          the hood); manual pins one exact provider + model. */}
      <Card title={t('ai.settings.model.selectionLabel')} description={isManual ? t('ai.settings.model.selection.manualHint') : t('ai.settings.model.selection.autoHint')}>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleUpdate({ model_selection: 'auto' })}
            className={`flex-1 rounded-lg border px-4 py-3 text-start text-sm font-medium transition-colors ${
              !isManual
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                : 'border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            {t('ai.settings.model.selection.auto')}
          </button>
          <button
            type="button"
            onClick={() => handleUpdate({ model_selection: 'manual' })}
            className={`flex-1 rounded-lg border px-4 py-3 text-start text-sm font-medium transition-colors ${
              isManual ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300' : 'border-slate-700 text-slate-300 hover:border-slate-600'
            }`}
          >
            {t('ai.settings.model.selection.manual')}
          </button>
        </div>
      </Card>

      {/* Model Configuration */}
      <Card title={t('ai.settings.model.title')} description={t('ai.settings.model.description')}>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
              <KeyRound className="h-3.5 w-3.5" /> {t('ai.settings.model.defaultProviderLabel')}
            </label>
            <select
              value={settings?.provider ?? 'openrouter'}
              onChange={(e) => handleUpdate({ provider: e.target.value })}
              className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}{statusFor(p.id)?.configured ? '' : ` (${t('ai.settings.providers.notConfigured')})`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.settings.model.defaultModelLabel')}</label>
            <input
              type="text"
              defaultValue={settings?.default_model ?? 'openrouter/auto'}
              onBlur={(e) => handleUpdate({ default_model: e.target.value })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="openrouter/auto"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('ai.settings.model.temperatureLabel')} <span className="font-mono">{settings?.temperature ?? 0.7}</span>
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                defaultValue={settings?.temperature ?? 0.7}
                onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.settings.model.maxTokensLabel')}</label>
              <input
                type="number"
                min="64"
                max="32000"
                defaultValue={settings?.max_tokens ?? 1024}
                onBlur={(e) => handleUpdate({ max_tokens: parseInt(e.target.value, 10) })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                defaultChecked={settings?.streaming ?? true}
                onChange={(e) => handleUpdate({ streaming: e.target.checked })}
                className="rounded"
              />
              {t('ai.settings.model.streaming')}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                defaultChecked={settings?.free_only_mode ?? true}
                onChange={(e) => handleUpdate({ free_only_mode: e.target.checked })}
                className="rounded"
                disabled={isManual}
              />
              {t('ai.settings.model.freeOnly')}
            </label>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.settings.model.modeLabel')}</label>
            <select
              defaultValue={settings?.mode ?? 'free'}
              onChange={(e) => handleUpdate({ mode: e.target.value })}
              className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="free">{t('ai.settings.model.mode.free')}</option>
              <option value="hybrid">{t('ai.settings.model.mode.hybrid')}</option>
              <option value="paid">{t('ai.settings.model.mode.paid')}</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Live model catalog for the active/default provider — fetched
          straight from the provider's API, the same way OpenRouter's model
          list works, instead of a manually-curated local table. */}
      <Card title={t('ai.settings.provider.title')} description={t('ai.settings.provider.description')}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleTest} loading={connState === 'testing'}>
              <Plug className="h-4 w-4" /> {t('ai.settings.apiKey.testButton')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleLoadModels} loading={loadingModels}>
              <Zap className="h-4 w-4" /> {t('ai.settings.provider.loadModels')}
            </Button>
            {connState === 'connected' && (
              <Badge variant="success"><CheckCircle2 className="me-1 h-3 w-3" /> {t('ai.settings.apiKey.connected')}</Badge>
            )}
            {connState === 'failed' && (
              <Badge variant="error"><XCircle className="me-1 h-3 w-3" /> {t('ai.settings.apiKey.failed')}</Badge>
            )}
            {models.length > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {t('ai.settings.provider.freeOfTotal', { free: freeModels.length, total: models.length })}
              </span>
            )}
          </div>
          {settings?.last_successful_model && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('ai.settings.apiKey.lastModel')} <span className="font-mono">{settings.last_successful_model}</span>
            </span>
          )}
          {loadingModels && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('ai.settings.provider.fetching')}
            </div>
          )}
          {models.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              {models.slice(0, 50).map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="font-mono text-slate-700 dark:text-slate-300">{m.id}</span>
                  {m.is_free ? <Badge variant="success">{t('common.free')}</Badge> : <Badge>{t('common.paid')}</Badge>}
                </div>
              ))}
              {models.length > 50 && <p className="px-2 py-1 text-xs text-slate-400">{t('ai.settings.provider.andMore', { count: models.length - 50 })}</p>}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
