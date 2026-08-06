import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Skeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { aiModelsRepository, type AiProviderWithModels } from '@/repositories/admin/aiModelsRepository';

type ModelForm = {
  provider_id: string;
  model_key: string;
  display_name: string;
  context_window: string;
  cost_per_1k_input: string;
  cost_per_1k_output: string;
  is_free: boolean;
};

const emptyModelForm = (providerId: string): ModelForm => ({
  provider_id: providerId,
  model_key: '',
  display_name: '',
  context_window: '32000',
  cost_per_1k_input: '0',
  cost_per_1k_output: '0',
  is_free: false,
});

export function AiModelsPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const [providers, setProviders] = useState<AiProviderWithModels[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    aiModelsRepository
      .list()
      .then(setProviders)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load AI providers'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const toggleProvider = async (id: string, isActive: boolean) => {
    try {
      await aiModelsRepository.toggleProvider(id, isActive);
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  };

  const toggleModel = async (id: string, isActive: boolean) => {
    try {
      await aiModelsRepository.toggleModel(id, isActive);
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  };

  const removeModel = async (id: string) => {
    try {
      await aiModelsRepository.removeModel(id);
      push({ title: t('admin.aiModels.toast.removed'), variant: 'success' });
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  };

  const saveModel = async () => {
    if (!modelForm) return;
    setSaving(true);
    try {
      await aiModelsRepository.createModel({
        provider_id: modelForm.provider_id,
        model_key: modelForm.model_key,
        display_name: modelForm.display_name,
        context_window: Number(modelForm.context_window) || 8192,
        cost_per_1k_input: Number(modelForm.cost_per_1k_input) || 0,
        cost_per_1k_output: Number(modelForm.cost_per_1k_output) || 0,
        is_free: modelForm.is_free,
      });
      push({ title: t('admin.aiModels.toast.added'), variant: 'success' });
      setModelForm(null);
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.aiModels.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.aiModels.subtitle')}</p>
      </div>

      {error && <ErrorState description={error} onRetry={load} />}

      {loading && !error && (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i}>
              <Skeleton className="mb-3 h-5 w-1/3" />
              <Skeleton className="h-16 w-full" />
            </Card>
          ))}
        </div>
      )}

      {!loading && !error && providers.length === 0 && <EmptyState title={t('admin.aiModels.empty')} />}

      {!loading && !error && providers.length > 0 && (
        <div className="space-y-4">
          {providers.map((provider) => (
            <Card
              key={provider.id}
              title={provider.display_name}
              description={provider.base_url ?? undefined}
              action={
                <div className="flex items-center gap-2">
                  <Badge variant={provider.is_active ? 'success' : 'default'} dot>
                    {provider.is_active ? t('admin.aiModels.active') : t('admin.aiModels.inactive')}
                  </Badge>
                  <Button size="sm" variant="outline" onClick={() => toggleProvider(provider.id, !provider.is_active)}>
                    {provider.is_active ? t('admin.aiModels.disable') : t('admin.aiModels.enable')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setModelForm(emptyModelForm(provider.id))}>
                    <Plus className="h-3.5 w-3.5" /> {t('admin.aiModels.addModel')}
                  </Button>
                </div>
              }
            >
              {provider.models.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('admin.aiModels.noModels')}</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {provider.models.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{m.display_name}</p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {m.model_key} · {m.context_window.toLocaleString()} {t('admin.aiModels.tokens')} ·{' '}
                          {m.is_free ? t('admin.aiModels.free') : `$${m.cost_per_1k_input}/$${m.cost_per_1k_output} ${t('admin.aiModels.per1k')}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={m.is_active ? 'success' : 'default'} dot>
                          {m.is_active ? t('admin.aiModels.active') : t('admin.aiModels.inactive')}
                        </Badge>
                        <Button size="sm" variant="ghost" onClick={() => toggleModel(m.id, !m.is_active)}>
                          {m.is_active ? t('admin.aiModels.disable') : t('admin.aiModels.enable')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removeModel(m.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={!!modelForm} onClose={() => setModelForm(null)} title={t('admin.aiModels.addModel')}>
        {modelForm && (
          <div className="space-y-4">
            <Input
              label={t('admin.aiModels.field.modelKey')}
              value={modelForm.model_key}
              onChange={(e) => setModelForm({ ...modelForm, model_key: e.target.value })}
              placeholder="gpt-4o-mini"
            />
            <Input
              label={t('admin.aiModels.field.displayName')}
              value={modelForm.display_name}
              onChange={(e) => setModelForm({ ...modelForm, display_name: e.target.value })}
            />
            <Input
              label={t('admin.aiModels.field.contextWindow')}
              type="number"
              value={modelForm.context_window}
              onChange={(e) => setModelForm({ ...modelForm, context_window: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label={t('admin.aiModels.field.costInput')}
                type="number"
                step="0.01"
                value={modelForm.cost_per_1k_input}
                onChange={(e) => setModelForm({ ...modelForm, cost_per_1k_input: e.target.value })}
              />
              <Input
                label={t('admin.aiModels.field.costOutput')}
                type="number"
                step="0.01"
                value={modelForm.cost_per_1k_output}
                onChange={(e) => setModelForm({ ...modelForm, cost_per_1k_output: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={modelForm.is_free}
                onChange={(e) => setModelForm({ ...modelForm, is_free: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t('admin.aiModels.field.isFree')}
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModelForm(null)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={saveModel} loading={saving} disabled={!modelForm.model_key || !modelForm.display_name}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
