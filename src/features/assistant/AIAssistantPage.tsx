import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Image as ImageIcon,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { useAISettings } from '@/hooks/useAISettings';
import { useAccounts } from '@/hooks/useAccounts';
import { useMedia } from '@/hooks/useMedia';
import { usePosts } from '@/hooks/usePosts';
import { publishingService } from '@/services/publishingService';
import { conversationRepository, messageRepository } from '@/repositories/conversationRepository';
import { supabase } from '@/services/supabase';
import { runPlannerAgent, runCreatorAgent, computeScheduleTimes, findMatchingMedia } from '@/services/assistantOrchestrator';
import { Badge, Button, Card, EmptyState } from '@/ui';
import type { CampaignPlan, DraftPost, AssistantStage, MonitoredPost } from '@/types/assistant';
import type { Post } from '@/types/social';
import { PLATFORM_IDS, getPlatformMeta, platformLabelFallback } from '@/constants/platforms';

const ALL_PLATFORMS = PLATFORM_IDS;

function platformLabel(t: (k: string) => string, platform: string): string {
  const key = `ai.studio.platform.${platform}`;
  const translated = t(key);
  return translated === key ? platformLabelFallback(platform) : translated;
}

function statusVariant(status: Post['status']): 'success' | 'info' | 'error' | 'warning' | 'default' {
  if (status === 'published') return 'success';
  if (status === 'scheduled' || status === 'publishing') return 'info';
  if (status === 'failed') return 'error';
  if (status === 'archived') return 'warning';
  return 'default';
}

function deriveTitle(content: string): string {
  const firstLine = content.split('\n').find((l) => l.trim().length > 0) ?? content;
  return firstLine.trim().slice(0, 80);
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `draft-${Date.now()}-${localIdCounter}`;
}

export function AIAssistantPage() {
  const { t } = useLanguage();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { push } = useToast();
  const { settings } = useAISettings();
  const { accounts } = useAccounts();
  const { items: mediaItems } = useMedia();
  const { create: createPost } = usePosts();

  const [requestText, setRequestText] = useState('');
  const [imagesEnabled, setImagesEnabled] = useState(false);
  const [stage, setStage] = useState<AssistantStage>('idle');
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [planWarning, setPlanWarning] = useState<string | null>(null);
  const [creatingProgress, setCreatingProgress] = useState({ done: 0, total: 0 });
  const [drafts, setDrafts] = useState<DraftPost[]>([]);
  const [monitored, setMonitored] = useState<MonitoredPost[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const runIdRef = useRef(0);

  const connectedPlatforms = useMemo(
    () => Array.from(new Set(accounts.filter((a) => a.status === 'connected').map((a) => a.platform))),
    [accounts],
  );

  const aiParams = { model: settings?.default_model, temperature: settings?.temperature, maxTokens: settings?.max_tokens };

  // Live-monitor approved posts through the existing publishing pipeline
  // (same cron/orchestrator that powers Automation & Publishing Queue) so
  // the Assistant can report success/failure without polling.
  useEffect(() => {
    if (!workspace || monitored.length === 0) return;
    const trackedIds = new Set(monitored.map((m) => m.postId));
    const handleChange = (payload: { new: Post }) => {
      const updated = payload.new;
      if (!trackedIds.has(updated.id)) return;
      setMonitored((prev) => {
        const idx = prev.findIndex((m) => m.postId === updated.id);
        if (idx === -1) return prev;
        const prevEntry = prev[idx];
        if (prevEntry.status === updated.status) return prev;
        if (updated.status === 'published') {
          push({ title: t('assistant.toast.postPublished'), description: prevEntry.title, variant: 'success' });
        } else if (updated.status === 'failed') {
          push({ title: t('assistant.toast.postFailed'), description: updated.error_message ?? prevEntry.title, variant: 'error' });
        }
        const next = [...prev];
        next[idx] = { ...prevEntry, status: updated.status, error_message: updated.error_message };
        return next;
      });
    };
    const channel = supabase
      .channel(`assistant-monitor-${workspace.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'posts', filter: `workspace_id=eq.${workspace.id}` },
        handleChange as (payload: unknown) => void,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, monitored.length]);

  const resetPipeline = useCallback(() => {
    setStage('idle');
    setPlan(null);
    setPlanWarning(null);
    setDrafts([]);
    setMonitored([]);
    setConversationId(null);
    setRequestText('');
    setCreatingProgress({ done: 0, total: 0 });
  }, []);

  const runPipeline = useCallback(async () => {
    if (!workspace || !user || !requestText.trim()) {
      push({ title: t('assistant.toast.enterRequest'), variant: 'error' });
      return;
    }
    const runId = ++runIdRef.current;
    setDrafts([]);
    setMonitored([]);
    setPlanWarning(null);

    // Best-effort thread so this run shows up alongside Playground
    // conversations in AI History — never blocks the pipeline.
    conversationRepository
      .create({ workspace_id: workspace.id, title: requestText.slice(0, 60) || 'AI Assistant campaign', model: aiParams.model })
      .then((conv) => {
        if (runIdRef.current !== runId) return;
        setConversationId(conv.id);
        messageRepository.create({ conversation_id: conv.id, role: 'user', content: requestText }).catch(() => {});
      })
      .catch(() => {});

    // 1. Planner Agent
    setStage('planning');
    const { plan: newPlan, error: plannerError } = await runPlannerAgent(workspace.id, requestText, connectedPlatforms, aiParams);
    if (runIdRef.current !== runId) return;
    setPlan(newPlan);
    if (plannerError) setPlanWarning(t('assistant.plan.fallbackWarning'));

    // 2. Creator Agent — automatically chained, no user action needed here.
    setStage('creating');
    setCreatingProgress({ done: 0, total: newPlan.post_count });
    const scheduleTimes = computeScheduleTimes(newPlan, newPlan.post_count);
    const created: DraftPost[] = [];
    for (let i = 0; i < newPlan.post_count; i++) {
      const { content, error } = await runCreatorAgent(workspace.id, newPlan, i, aiParams);
      if (runIdRef.current !== runId) return;
      const finalContent = content || t('assistant.draft.generationFailedPlaceholder');
      if (error) push({ title: t('assistant.toast.postGenerationIssue', { index: i + 1 }), description: error, variant: 'error' });
      const media_urls = imagesEnabled ? [findMatchingMedia(`${newPlan.objective} ${finalContent}`, mediaItems)].filter((u): u is string => !!u) : [];
      created.push({
        local_id: nextLocalId(),
        content: finalContent,
        platforms: newPlan.platforms,
        scheduled_for: scheduleTimes[i].toISOString(),
        media_urls,
      });
      setCreatingProgress({ done: i + 1, total: newPlan.post_count });
      setDrafts([...created]);
    }

    // 3. Publisher Agent — build the preview. Nothing is saved yet.
    setStage('preparing');
    await new Promise((r) => setTimeout(r, 250));
    if (runIdRef.current !== runId) return;
    setStage('review');
  }, [workspace, user, requestText, connectedPlatforms, aiParams, imagesEnabled, mediaItems, push, t]);

  const updateDraft = (localId: string, patch: Partial<DraftPost>) => {
    setDrafts((prev) => prev.map((d) => (d.local_id === localId ? { ...d, ...patch } : d)));
  };

  const removeDraft = (localId: string) => {
    setDrafts((prev) => prev.filter((d) => d.local_id !== localId));
  };

  const togglePlatform = (localId: string, platform: string) => {
    setDrafts((prev) =>
      prev.map((d) => {
        if (d.local_id !== localId) return d;
        const has = d.platforms.includes(platform);
        const platforms = has ? d.platforms.filter((p) => p !== platform) : [...d.platforms, platform];
        return { ...d, platforms };
      }),
    );
  };

  const regenerateDraft = async (localId: string) => {
    if (!workspace || !plan) return;
    const index = drafts.findIndex((d) => d.local_id === localId);
    if (index === -1) return;
    updateDraft(localId, { generating: true });
    const { content, error } = await runCreatorAgent(workspace.id, plan, index, aiParams);
    if (error) {
      push({ title: t('assistant.toast.regenerateFailed'), description: error, variant: 'error' });
      updateDraft(localId, { generating: false });
      return;
    }
    updateDraft(localId, { content, generating: false });
  };

  const approveAndSchedule = async () => {
    if (!workspace || !user || drafts.length === 0) return;
    const invalid = drafts.find((d) => !d.content.trim() || d.platforms.length === 0);
    if (invalid) {
      push({ title: t('assistant.toast.fixDraftsFirst'), variant: 'error' });
      return;
    }
    setStage('scheduling');
    const results: MonitoredPost[] = [];
    const now = Date.now();

    for (const draft of drafts) {
      const post = await createPost({
        title: deriveTitle(draft.content),
        content: draft.content,
        platforms: draft.platforms,
        scheduled_for: draft.scheduled_for,
        media_urls: draft.media_urls,
        status: 'scheduled',
      });
      if (!post) {
        push({ title: t('assistant.toast.saveFailed'), description: draft.content.slice(0, 60), variant: 'error' });
        continue;
      }
      results.push({ postId: post.id, title: post.title ?? deriveTitle(draft.content), status: post.status, error_message: null });

      // Due-now posts get published immediately instead of waiting on the
      // once-a-minute scheduler, using the same edge function Manual
      // "Publish Now" uses on the Posts page.
      if (new Date(draft.scheduled_for).getTime() <= now + 60_000) {
        publishingService.publishNow(post.id, workspace.id).catch((e) => {
          push({ title: t('assistant.toast.postFailed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
        });
      }
    }

    if (conversationId) {
      messageRepository
        .create({
          conversation_id: conversationId,
          role: 'assistant',
          content: `Scheduled ${results.length} post(s) across ${Array.from(new Set(drafts.flatMap((d) => d.platforms))).join(', ')}.`,
        })
        .catch(() => {});
    }

    setMonitored(results);
    setStage('monitoring');
    push({ title: t('assistant.toast.scheduled', { count: results.length }), variant: 'success' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
          <Bot className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('assistant.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('assistant.subtitle')}</p>
        </div>
      </div>

      {connectedPlatforms.length === 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('assistant.warning.noAccounts')}</p>
        </div>
      )}

      {stage === 'idle' && (
        <Card title={t('assistant.input.title')} description={t('assistant.input.description')}>
          <div className="space-y-4">
            <textarea
              value={requestText}
              onChange={(e) => setRequestText(e.target.value)}
              rows={4}
              placeholder={t('assistant.input.placeholder')}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input type="checkbox" checked={imagesEnabled} onChange={(e) => setImagesEnabled(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
                <ImageIcon className="h-4 w-4" /> {t('assistant.input.enableImages')}
              </label>
              <Button onClick={runPipeline} disabled={!requestText.trim()}>
                <Sparkles className="h-4 w-4" /> {t('assistant.input.submit')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {stage !== 'idle' && (
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <PipelineStep icon={Bot} label={t('assistant.stage.planning')} active={stage === 'planning'} done={stage !== 'planning'} />
            <StepConnector />
            <PipelineStep icon={Wand2} label={t('assistant.stage.creating')} active={stage === 'creating'} done={!['planning', 'creating'].includes(stage)} />
            <StepConnector />
            <PipelineStep
              icon={Calendar}
              label={t('assistant.stage.publishing')}
              active={stage === 'preparing' || stage === 'scheduling'}
              done={stage === 'review' || stage === 'monitoring'}
            />
          </div>
          {stage === 'creating' && creatingProgress.total > 0 && (
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {t('assistant.stage.creatingProgress', { done: creatingProgress.done, total: creatingProgress.total })}
            </p>
          )}
        </Card>
      )}

      {plan && stage !== 'idle' && (
        <Card title={t('assistant.plan.title')} description={t('assistant.plan.description')}>
          {planWarning && (
            <div className="mb-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {planWarning}
            </div>
          )}
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <PlanField label={t('assistant.plan.objective')} value={plan.objective} />
            <PlanField label={t('assistant.plan.audience')} value={plan.audience} />
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('assistant.plan.platforms')}</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {plan.platforms.map((p) => (
                  <Badge key={p} variant="info">{platformLabel(t, p)}</Badge>
                ))}
              </dd>
            </div>
            <PlanField label={t('assistant.plan.cadence')} value={`${t(`assistant.cadence.${plan.cadence}`)} · ${plan.post_count} ${t('assistant.plan.posts')}`} />
          </dl>
        </Card>
      )}

      {stage === 'review' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('assistant.review.title')}</h2>
            <Badge variant="default">{t('assistant.review.count', { count: drafts.length })}</Badge>
          </div>

          {drafts.length === 0 ? (
            <EmptyState icon={<Wand2 className="h-10 w-10" />} title={t('assistant.review.empty.title')} description={t('assistant.review.empty.description')} />
          ) : (
            <div className="space-y-4">
              {drafts.map((draft, idx) => (
                <Card key={draft.local_id}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {t('assistant.review.postLabel', { index: idx + 1 })}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => regenerateDraft(draft.local_id)} loading={draft.generating}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => removeDraft(draft.local_id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <textarea
                    value={draft.content}
                    onChange={(e) => updateDraft(draft.local_id, { content: e.target.value })}
                    rows={4}
                    className="mt-3 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />

                  {draft.media_urls[0] && (
                    <div className="mt-3 flex items-center gap-3">
                      <img src={draft.media_urls[0]} alt="" className="h-16 w-16 rounded-lg object-cover" />
                      <Button variant="ghost" size="sm" onClick={() => updateDraft(draft.local_id, { media_urls: [] })}>
                        <X className="h-3.5 w-3.5" /> {t('assistant.review.removeImage')}
                      </Button>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_PLATFORMS.map((p) => {
                        const Icon = getPlatformMeta(p)?.icon ?? Link2;
                        const active = draft.platforms.includes(p);
                        return (
                          <button
                            key={p}
                            onClick={() => togglePlatform(draft.local_id, p)}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                              active
                                ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                                : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'
                            }`}
                          >
                            <Icon className="h-3 w-3" /> {platformLabel(t, p)}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="datetime-local"
                      value={toLocalInputValue(draft.scheduled_for)}
                      onChange={(e) => updateDraft(draft.local_id, { scheduled_for: new Date(e.target.value).toISOString() })}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                    />
                  </div>
                </Card>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" onClick={resetPipeline}>
              {t('assistant.review.discard')}
            </Button>
            <Button onClick={approveAndSchedule} disabled={drafts.length === 0}>
              <Send className="h-4 w-4" /> {t('assistant.review.approve')}
            </Button>
          </div>
        </div>
      )}

      {stage === 'scheduling' && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('assistant.scheduling.inProgress')}
        </div>
      )}

      {stage === 'monitoring' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('assistant.monitor.title')}</h2>
            <Button variant="outline" size="sm" onClick={resetPipeline}>
              <Plus className="h-3.5 w-3.5" /> {t('assistant.monitor.newCampaign')}
            </Button>
          </div>
          <Card>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {monitored.map((m) => (
                <li key={m.postId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{m.title}</p>
                    {m.error_message && <p className="mt-0.5 truncate text-xs text-rose-600 dark:text-rose-400">{m.error_message}</p>}
                  </div>
                  <Badge variant={statusVariant(m.status)} dot>
                    {t(`post.status.${m.status}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('assistant.monitor.hint')}</p>
        </div>
      )}
    </div>
  );
}

function PlanField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800 dark:text-slate-200">{value}</dd>
    </div>
  );
}

function PipelineStep({ icon: Icon, label, active, done }: { icon: typeof Bot; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-full ${
          done
            ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
            : active
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
              : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      </div>
      <span className={`text-sm font-medium ${active || done ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>{label}</span>
    </div>
  );
}

function StepConnector() {
  return <div className="h-px w-6 shrink-0 bg-slate-200 dark:bg-slate-700 sm:w-10" />;
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
