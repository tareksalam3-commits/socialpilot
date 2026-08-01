import { useState } from 'react';
import { CheckCircle2, Loader2, Plug, Save, XCircle, Zap } from 'lucide-react';
import { useAISettings } from '@/hooks/useAISettings';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { aiGateway } from '@/services/aiGateway';
import { Badge, Button, Card, Input } from '@/ui';
import type { ModelInfo } from '@/types/ai';

type ConnState = 'idle' | 'testing' | 'connected' | 'failed';

export function AISettingsPage() {
  const { workspace } = useWorkspace();
  const { settings, loading, update, setApiKey } = useAISettings();
  const { push } = useToast();

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [connState, setConnState] = useState<ConnState>('idle');
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSaveKey = async () => {
    if (!apiKeyInput.trim()) {
      push({ title: 'Enter an API key', variant: 'error' });
      return;
    }
    setSaving(true);
    try {
      await setApiKey(apiKeyInput);
      setApiKeyInput('');
      push({ title: 'API key saved', description: 'Your OpenRouter key is stored securely.', variant: 'success' });
    } catch (e) {
      push({ title: 'Failed to save key', description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!workspace) return;
    setConnState('testing');
    try {
      await aiGateway.testConnection(workspace.id);
      setConnState('connected');
      push({ title: 'Connection successful', description: 'OpenRouter is reachable.', variant: 'success' });
    } catch (e) {
      setConnState('failed');
      push({ title: 'Connection failed', description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  const handleLoadModels = async () => {
    if (!workspace) return;
    setLoadingModels(true);
    try {
      const result = await aiGateway.listModels(workspace.id);
      setModels(result.models);
      push({ title: 'Models loaded', description: `${result.free_count} free of ${result.total_count} models available.`, variant: 'success' });
    } catch (e) {
      push({ title: 'Failed to load models', description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setLoadingModels(false);
    }
  };

  const handleUpdate = async (patch: Record<string, unknown>) => {
    try {
      await update(patch);
      push({ title: 'Settings updated', variant: 'success' });
    } catch (e) {
      push({ title: 'Update failed', description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  if (loading) {
    return <div className="space-y-6"><div className="h-32 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" /></div>;
  }

  const freeModels = models.filter((m) => m.is_free);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AI Settings</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Configure your AI engine, API keys, and model preferences.</p>
      </div>

      {/* API Key */}
      <Card title="OpenRouter API Key" description="Your key is stored encrypted and never exposed to the browser.">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="sk-or-v1-…"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              className="flex-1"
            />
            <Button onClick={handleSaveKey} loading={saving}>
              <Save className="h-4 w-4" /> Save Key
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleTest} loading={connState === 'testing'}>
              <Plug className="h-4 w-4" /> Test Connection
            </Button>
            {connState === 'connected' && (
              <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" /> Connected</Badge>
            )}
            {connState === 'failed' && (
              <Badge variant="error"><XCircle className="mr-1 h-3 w-3" /> Failed</Badge>
            )}
            {settings?.last_successful_model && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Last successful model: <span className="font-mono">{settings.last_successful_model}</span>
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Model Configuration */}
      <Card title="Model Configuration" description="Set defaults for AI generation across the platform.">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Default Model</label>
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
                Temperature: <span className="font-mono">{settings?.temperature ?? 0.7}</span>
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
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Max Tokens</label>
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
              Streaming
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                defaultChecked={settings?.free_only_mode ?? true}
                onChange={(e) => handleUpdate({ free_only_mode: e.target.checked })}
                className="rounded"
              />
              Free models only
            </label>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Mode</label>
            <select
              defaultValue={settings?.mode ?? 'free'}
              onChange={(e) => handleUpdate({ mode: e.target.value })}
              className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            >
              <option value="free">Free (only free models)</option>
              <option value="hybrid">Hybrid (free first, then paid)</option>
              <option value="paid">Paid (use any model)</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Provider & Model Status */}
      <Card title="Provider Status" description="Check which models are available through OpenRouter.">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleLoadModels} loading={loadingModels}>
              <Zap className="h-4 w-4" /> Load Available Models
            </Button>
            {models.length > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {freeModels.length} free / {models.length} total
              </span>
            )}
          </div>
          {loadingModels && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Fetching models…
            </div>
          )}
          {models.length > 0 && (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800">
              {models.slice(0, 50).map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800">
                  <span className="font-mono text-slate-700 dark:text-slate-300">{m.id}</span>
                  {m.is_free ? <Badge variant="success">Free</Badge> : <Badge>Paid</Badge>}
                </div>
              ))}
              {models.length > 50 && <p className="px-2 py-1 text-xs text-slate-400">…and {models.length - 50} more</p>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { name: 'OpenRouter', status: 'active' },
              { name: 'Groq', status: 'prepared' },
              { name: 'Google AI', status: 'prepared' },
              { name: 'HuggingFace', status: 'prepared' },
              { name: 'Cloudflare AI', status: 'prepared' },
              { name: 'Ollama', status: 'prepared' },
            ].map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{p.name}</span>
                <Badge variant={p.status === 'active' ? 'success' : 'default'}>
                  {p.status === 'active' ? 'Active' : 'Ready'}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
