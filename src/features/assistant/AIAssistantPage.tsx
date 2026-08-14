import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Bot,
  Calendar,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Pause,
  Plus,
  RefreshCw,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { AUDIENCE_MIN_CONFIDENCE } from '@/engines/aiOrchestrator';
import { Badge, Button, Card, EmptyState } from '@/ui';
import type { Post } from '@/types/social';
import type { AssistantStage, DraftPost } from '@/types/assistant';
import { PLATFORM_IDS, getPlatformMeta, platformLabelFallback } from '@/constants/platforms';
import { useAssistantPipeline } from './useAssistantPipeline';

const ALL_PLATFORMS = PLATFORM_IDS;
const QC_PASS_SCORE = 90;

type WorkspaceCopy = {
  title: string;
  description: string;
};

type TimelineItem = {
  key: 'planning' | 'audience' | 'collecting' | 'creating' | 'quality' | 'publishing';
  icon: typeof Bot;
};

const STAGE_RANK: Record<Exclude<AssistantStage, 'idle'> | 'publishing', number> = {
  planning: 1,
  audience: 2,
  collecting: 3,
  creating: 4,
  quality: 5,
  preparing: 6,
  publishing: 6,
  review: 7,
  scheduling: 8,
  monitoring: 9,
};

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

function qcBadgeVariant(score: number): 'success' | 'warning' | 'error' {
  if (score >= QC_PASS_SCORE) return 'success';
  if (score >= 70) return 'warning';
  return 'error';
}

function stageRank(stage: AssistantStage): number {
  return stage === 'idle' ? 0 : STAGE_RANK[stage];
}

function isTimelineActive(stage: AssistantStage, key: TimelineItem['key']): boolean {
  if (key === 'publishing') return stage === 'preparing' || stage === 'scheduling';
  return stage === key;
}

function isTimelineDone(stage: AssistantStage, key: TimelineItem['key']): boolean {
  if (stage === 'monitoring') return true;
  const keyRank = key === 'publishing' ? STAGE_RANK.publishing : STAGE_RANK[key];
  return stageRank(stage) > keyRank;
}

function currentActionFor(stage: AssistantStage, t: (key: string) => string): WorkspaceCopy {
  const key = stage === 'preparing' ? 'preparing' : stage === 'scheduling' ? 'scheduling' : stage;
  return {
    title: t(`assistant.workspace.current.${key}Title`),
    description: t(`assistant.workspace.current.${key}Desc`),
  };
}

function postState(draft: DraftPost, stage: AssistantStage, t: (key: string) => string): { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'default' } {
  if (draft.generating) return { label: t('assistant.workspace.post.generating'), variant: 'info' };
  if (draft.approved) return { label: t('assistant.workspace.post.approved'), variant: 'success' };
  if (draft.needsReview || draft.quality_error) return { label: t('assistant.workspace.post.needsReview'), variant: 'warning' };
  if (stage === 'monitoring') return { label: t('assistant.workspace.post.live'), variant: 'success' };
  return { label: t('assistant.workspace.post.ready'), variant: 'default' };
}

export function AIAssistantPage() {
  const {
    t,
    connectedPlatforms,
    requestText,
    setRequestText,
    imagesEnabled,
    setImagesEnabled,
    stage,
    plan,
    planWarning,
    audienceInference,
    audienceEditing,
    setAudienceEditing,
    audienceDraft,
    setAudienceDraft,
    creatingProgress,
    creationPhase,
    drafts,
    monitored,
    usedSources,
    runPipeline,
    approveAudience,
    confirmAudienceEdit,
    updateDraft,
    removeDraft,
    togglePlatform,
    regenerateDraft,
    proceedFromQuality,
    approveAndSchedule,
    resetPipeline,
  } = useAssistantPipeline();

  const isWorkspace = stage !== 'idle';
  const isRunning = ['planning', 'audience', 'collecting', 'creating', 'quality', 'preparing', 'scheduling'].includes(stage);
  const totalPosts = plan?.post_count ?? creatingProgress.total;
  const completedPosts = stage === 'review' || stage === 'monitoring' ? totalPosts : Math.min(creatingProgress.done, totalPosts);
  const progressPercent = totalPosts > 0 ? Math.round((completedPosts / totalPosts) * 100) : 0;
  const campaignName = plan?.objective || requestText.split('\n')[0].trim() || t('assistant.title');
  const currentAction = currentActionFor(stage, t);

  const cancelCampaign = () => {
    if (typeof window !== 'undefined' && window.confirm(t('assistant.workspace.bottom.confirmCancel'))) {
      resetPipeline();
    }
  };

  return (
    <div className={`relative space-y-5 ${isRunning ? 'pb-24' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950">
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-600 dark:text-sky-400">{t('assistant.title')}</p>
            <h1 className="truncate text-xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-2xl">{isWorkspace ? campaignName : t('assistant.title')}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              {isWorkspace ? t('assistant.workspace.campaignDescription') : t('assistant.subtitle')}
            </p>
          </div>
        </div>
        {isWorkspace && (
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={stage === 'monitoring' ? 'success' : 'info'} dot>
              {stage === 'monitoring' ? t('assistant.workspace.bottom.completed') : t('assistant.workspace.running')}
            </Badge>
            <button
              type="button"
              aria-label={t('assistant.workspace.back')}
              onClick={() => window.history.back()}
              className="press-effect hidden h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-900 sm:flex dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {connectedPlatforms.length === 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('assistant.warning.noAccounts')}</p>
        </div>
      )}

      {stage === 'idle' && <CampaignPrompt {...{ requestText, setRequestText, imagesEnabled, setImagesEnabled, runPipeline, t }} />}

      {isWorkspace && (
        <>
          <ProgressOverview
            t={t}
            completedPosts={completedPosts}
            totalPosts={totalPosts}
            progressPercent={progressPercent}
            currentAction={currentAction}
            creationPhase={creationPhase}
            stage={stage}
          />

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.8fr)]">
            <div className="min-w-0 space-y-5">
              <CurrentActionCard
                t={t}
                stage={stage}
                currentAction={currentAction}
                drafts={drafts}
                completedPosts={completedPosts}
                totalPosts={totalPosts}
                creationPhase={creationPhase}
              />

              {stage === 'audience' && audienceInference && (
                <AudienceApprovalCard
                  t={t}
                  audienceInference={audienceInference}
                  audienceEditing={audienceEditing}
                  setAudienceEditing={setAudienceEditing}
                  audienceDraft={audienceDraft}
                  setAudienceDraft={setAudienceDraft}
                  approveAudience={approveAudience}
                  confirmAudienceEdit={confirmAudienceEdit}
                />
              )}

              {stage === 'creating' && drafts.length > 0 && (
                <LivePostsFeed t={t} drafts={drafts} stage={stage} totalPosts={totalPosts} />
              )}

              {stage === 'quality' && (
                <QualityReviewPanel
                  t={t}
                  drafts={drafts}
                  updateDraft={updateDraft}
                  regenerateDraft={regenerateDraft}
                  resetPipeline={resetPipeline}
                  proceedFromQuality={proceedFromQuality}
                />
              )}

              {stage === 'review' && (
                <ReviewAndSchedulePanel
                  t={t}
                  drafts={drafts}
                  connectedPlatforms={connectedPlatforms}
                  updateDraft={updateDraft}
                  removeDraft={removeDraft}
                  togglePlatform={togglePlatform}
                  regenerateDraft={regenerateDraft}
                  resetPipeline={resetPipeline}
                  approveAndSchedule={approveAndSchedule}
                />
              )}

              {stage === 'monitoring' && (
                <CompletedCampaignPanel
                  t={t}
                  drafts={drafts}
                  monitored={monitored}
                  resetPipeline={resetPipeline}
                />
              )}
            </div>

            <aside className="min-w-0 space-y-5">
              <ActivityTimeline t={t} stage={stage} includeSources={Boolean(plan?.use_content_sources)} />
              {plan && <CampaignSummary t={t} plan={plan} planWarning={planWarning} platformLabel={platformLabel} />}
              {usedSources.length > 0 && <SourcesSummary t={t} usedSources={usedSources} />}
            </aside>
          </div>
        </>
      )}

      {isRunning && (
        <BottomExecutionBar t={t} completedPosts={completedPosts} totalPosts={totalPosts} cancelCampaign={cancelCampaign} />
      )}
    </div>
  );
}

function CampaignPrompt({
  requestText,
  setRequestText,
  imagesEnabled,
  setImagesEnabled,
  runPipeline,
  t,
}: {
  requestText: string;
  setRequestText: (value: string) => void;
  imagesEnabled: boolean;
  setImagesEnabled: (value: boolean) => void;
  runPipeline: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200/80 shadow-card-hover dark:border-slate-800">
      <div className="relative overflow-hidden border-b border-slate-100 bg-slate-950 px-5 py-6 text-white sm:px-7 dark:border-slate-800">
        <div className="absolute -left-8 -top-12 h-36 w-36 rounded-full bg-sky-400/15 blur-3xl" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-sky-100">
              <Sparkles className="h-3.5 w-3.5" /> AI campaign workspace
            </div>
            <h2 className="text-xl font-semibold tracking-tight">{t('assistant.input.title')}</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">{t('assistant.input.description')}</p>
          </div>
          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 sm:flex">
            <Rocket className="h-5 w-5 text-sky-300" />
          </div>
        </div>
      </div>
      <div className="space-y-4 p-5 sm:p-7">
        <textarea
          value={requestText}
          onChange={(e) => setRequestText(e.target.value)}
          rows={5}
          placeholder={t('assistant.input.placeholder')}
          className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 transition-colors placeholder:text-slate-400 focus:border-sky-400 focus:outline-none focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-sky-500 dark:focus:ring-sky-950"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={imagesEnabled} onChange={(e) => setImagesEnabled(e.target.checked)} className="h-4 w-4 rounded border-slate-300 accent-slate-900" />
            <ImageIcon className="h-4 w-4" />
            <span>{t('assistant.input.enableImages')}</span>
          </label>
          <Button onClick={runPipeline} disabled={!requestText.trim()} className="w-full justify-center sm:w-auto">
            <Sparkles className="h-4 w-4" /> {t('assistant.input.submit')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ProgressOverview({
  t,
  completedPosts,
  totalPosts,
  progressPercent,
  currentAction,
  creationPhase,
  stage,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  completedPosts: number;
  totalPosts: number;
  progressPercent: number;
  currentAction: WorkspaceCopy;
  creationPhase: string | null;
  stage: AssistantStage;
}) {
  return (
    <Card className="rounded-2xl border-slate-200/80 shadow-subtle dark:border-slate-800">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-sky-600 dark:text-sky-400">
            <Activity className="h-3.5 w-3.5" /> {t('assistant.workspace.progressTitle')}
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{t('assistant.workspace.postsProgress', { done: completedPosts, total: totalPosts || 0 })}</p>
            <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{progressPercent}%</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
          <span>{currentAction.title}</span>
        </div>
      </div>
      <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-slate-950 transition-[width] duration-500 ease-out dark:bg-white" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>{currentAction.description}</span>
        <span className="flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5" />
          {stage === 'creating' && creationPhase ? t(`assistant.stage.creationPhase.${creationPhase}`) : t(`assistant.stage.${stage === 'preparing' || stage === 'scheduling' ? 'publishing' : stage}`)}
        </span>
      </div>
    </Card>
  );
}

function ActivityTimeline({
  t,
  stage,
  includeSources,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  stage: AssistantStage;
  includeSources: boolean;
}) {
  const items: TimelineItem[] = [
    { key: 'planning', icon: Bot },
    { key: 'audience', icon: Users },
    ...(includeSources ? [{ key: 'collecting' as const, icon: Database }] : []),
    { key: 'creating', icon: Wand2 },
    { key: 'quality', icon: ShieldCheck },
    { key: 'publishing', icon: Calendar },
  ];

  return (
    <Card title={t('assistant.workspace.timelineTitle')} className="rounded-2xl border-slate-200/80 shadow-subtle dark:border-slate-800">
      <div className="space-y-0">
        {items.map((item, index) => {
          const active = isTimelineActive(stage, item.key);
          const done = isTimelineDone(stage, item.key);
          const Icon = item.icon;
          return (
            <div key={item.key} className="relative flex gap-3 pb-5 last:pb-0">
              {index < items.length - 1 && <span className={`absolute bottom-0 right-[15px] top-8 w-px ${done ? 'bg-emerald-200 dark:bg-emerald-900' : 'bg-slate-200 dark:bg-slate-800'}`} />}
              <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${done ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400' : active ? 'border-sky-200 bg-sky-50 text-sky-600 shadow-sm dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-400' : 'border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500'}`}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className={`min-w-0 rounded-xl px-3 py-2 ${active ? 'bg-sky-50/70 dark:bg-sky-950/20' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`text-sm font-semibold ${active ? 'text-slate-950 dark:text-white' : done ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>{t(`assistant.workspace.timeline.${item.key}`)}</p>
                  {active && <Badge variant="info" dot>{t('assistant.workspace.running')}</Badge>}
                  {done && <span className="text-xs text-emerald-600 dark:text-emerald-400">تم</span>}
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t(`assistant.workspace.timeline.${item.key}Desc`)}</p>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function CurrentActionCard({
  t,
  stage,
  currentAction,
  drafts,
  completedPosts,
  totalPosts,
  creationPhase,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  stage: AssistantStage;
  currentAction: WorkspaceCopy;
  drafts: DraftPost[];
  completedPosts: number;
  totalPosts: number;
  creationPhase: string | null;
}) {
  const activeDraftIndex = drafts.findIndex((draft) => draft.generating || !draft.content);
  const previewDraft = activeDraftIndex >= 0 ? drafts[activeDraftIndex] : null;
  const isCreating = stage === 'creating';
  const isQuality = stage === 'quality';
  const icon = isQuality ? ShieldCheck : isCreating ? Wand2 : stage === 'audience' ? Target : Bot;
  const Icon = icon;

  return (
    <section className="overflow-hidden rounded-2xl bg-slate-950 text-white shadow-card-hover dark:bg-slate-900">
      <div className="relative border-b border-white/10 px-5 py-5 sm:px-7">
        <div className="absolute -left-20 -top-24 h-56 w-56 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-sky-300">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-300">{t('assistant.workspace.currentAction')}</p>
              {isCreating && creationPhase && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-slate-300">{t(`assistant.stage.creationPhase.${creationPhase}`)}</span>}
            </div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">{currentAction.title}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{currentAction.description}</p>
          </div>
          <span className="mt-1 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-sky-400 shadow-[0_0_0_5px_rgba(56,189,248,0.12)]" />
        </div>
      </div>

      {isCreating && (
        <div className="p-5 sm:p-7">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-slate-200">{previewDraft ? `المنشور ${activeDraftIndex + 1} من ${totalPosts}` : t('assistant.workspace.postsProgress', { done: completedPosts, total: totalPosts })}</p>
            <span className="text-xs text-slate-400">{completedPosts}/{totalPosts || 0}</span>
          </div>
          <PostSkeletonPreview draft={previewDraft} />
        </div>
      )}

      {isQuality && (
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-2xl font-semibold">{drafts.filter((draft) => draft.approved).length}/{drafts.length}</p>
            <p className="mt-1 text-xs text-slate-400">منشورات اجتازت مراجعة الجودة</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-2xl font-semibold">{drafts.filter((draft) => draft.needsReview || draft.quality_error).length}</p>
            <p className="mt-1 text-xs text-slate-400">منشورات تحتاج انتباهًا</p>
          </div>
        </div>
      )}
    </section>
  );
}

function PostSkeletonPreview({ draft }: { draft: DraftPost | null }) {
  if (draft?.content) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <FileText className="h-3.5 w-3.5" /> معاينة حية
        </div>
        <p className="mt-3 line-clamp-5 whitespace-pre-wrap text-sm leading-6 text-slate-200">{draft.content}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4" aria-label="Loading post preview">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <FileText className="h-3.5 w-3.5" /> معاينة المنشور
      </div>
      <div className="mt-4 space-y-3">
        <div className="skeleton-shimmer h-3 w-28 animate-[shimmer_1.8s_linear_infinite] rounded-full opacity-70" />
        <div className="skeleton-shimmer h-3 w-full animate-[shimmer_1.8s_linear_infinite] rounded-full opacity-70" />
        <div className="skeleton-shimmer h-3 w-11/12 animate-[shimmer_1.8s_linear_infinite] rounded-full opacity-70" />
        <div className="skeleton-shimmer h-3 w-3/5 animate-[shimmer_1.8s_linear_infinite] rounded-full opacity-70" />
      </div>
    </div>
  );
}

function LivePostsFeed({
  t,
  drafts,
  stage,
  totalPosts,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  drafts: DraftPost[];
  stage: AssistantStage;
  totalPosts: number;
}) {
  return (
    <Card title="المنشورات التي تتكوّن الآن" description={`${drafts.filter((draft) => !draft.generating).length} من ${totalPosts || drafts.length} جاهزة للعرض`} className="rounded-2xl border-slate-200/80 shadow-subtle dark:border-slate-800">
      <div className="space-y-3">
        {drafts.map((draft, index) => {
          const state = postState(draft, stage, t);
          const score = draft.quality?.score;
          return (
            <div key={draft.local_id} className={`rounded-2xl border p-4 transition-all duration-200 ${draft.generating ? 'border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
              <div className="flex items-start gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${draft.generating ? 'bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {draft.generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">المنشور {index + 1}</p>
                    <Badge variant={state.variant} dot>{state.label}</Badge>
                  </div>
                  {draft.generating ? (
                    <div className="mt-3 space-y-2">
                      <div className="skeleton-shimmer h-2.5 w-11/12 animate-pulse rounded-full" />
                      <div className="skeleton-shimmer h-2.5 w-4/5 animate-pulse rounded-full" />
                    </div>
                  ) : (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{draft.content}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {score !== undefined && <span className="flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> {t('assistant.workspace.post.quality')}: {score}/100</span>}
                    {draft.platforms.slice(0, 3).map((platform) => <span key={platform} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{platformLabelFallback(platform)}</span>)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function AudienceApprovalCard({
  t,
  audienceInference,
  audienceEditing,
  setAudienceEditing,
  audienceDraft,
  setAudienceDraft,
  approveAudience,
  confirmAudienceEdit,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  audienceInference: { audience: string; reason: string; confidence: number };
  audienceEditing: boolean;
  setAudienceEditing: (value: boolean) => void;
  audienceDraft: string;
  setAudienceDraft: (value: string) => void;
  approveAudience: () => void;
  confirmAudienceEdit: () => void;
}) {
  return (
    <Card title={t('assistant.audience.title')} description={t('assistant.audience.description')} className="rounded-2xl border-sky-200/80 shadow-subtle dark:border-sky-900/70">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400"><Users className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          {!audienceEditing ? (
            <>
              <p className="text-base font-semibold text-slate-950 dark:text-white">{audienceInference.audience}</p>
              {audienceInference.reason && <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{audienceInference.reason}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant={audienceInference.confidence < AUDIENCE_MIN_CONFIDENCE ? 'warning' : 'success'} dot>{audienceInference.confidence < AUDIENCE_MIN_CONFIDENCE ? t('assistant.audience.needsReview') : t('assistant.audience.suggested')}</Badge>
                <span className="text-xs text-slate-500 dark:text-slate-400">{Math.round(audienceInference.confidence * 100)}% ثقة</span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" onClick={approveAudience}><CheckCircle2 className="h-3.5 w-3.5" /> {t('assistant.audience.approve')}</Button>
                <Button variant="outline" size="sm" onClick={() => { setAudienceDraft(audienceInference.audience); setAudienceEditing(true); }}>{t('assistant.audience.change')}</Button>
              </div>
            </>
          ) : (
            <>
              <input type="text" value={audienceDraft} onChange={(e) => setAudienceDraft(e.target.value)} placeholder={t('assistant.audience.placeholder')} autoFocus className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={confirmAudienceEdit} disabled={!audienceDraft.trim()}><CheckCircle2 className="h-3.5 w-3.5" /> {t('assistant.audience.confirm')}</Button>
                <Button variant="outline" size="sm" onClick={() => setAudienceEditing(false)}>{t('assistant.audience.cancel')}</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

function QualityReviewPanel({
  t,
  drafts,
  updateDraft,
  regenerateDraft,
  resetPipeline,
  proceedFromQuality,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  drafts: DraftPost[];
  updateDraft: (localId: string, patch: Partial<DraftPost>) => void;
  regenerateDraft: (localId: string) => void;
  resetPipeline: () => void;
  proceedFromQuality: () => void;
}) {
  return (
    <Card title="مراجعة الجودة" description="كل منشور يمر بفحص مستقل قبل أن يصبح جاهزًا للنشر." className="rounded-2xl border-slate-200/80 shadow-subtle dark:border-slate-800">
      <div className="space-y-4">
        {drafts.map((draft, index) => {
          const isApproved = draft.approved === true;
          const needsReview = draft.needsReview || draft.quality_error || draft.approved === false;
          return (
            <div key={draft.local_id} className={`rounded-2xl border p-4 sm:p-5 ${isApproved ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/70 dark:bg-emerald-950/20' : needsReview ? 'border-amber-200 bg-amber-50/40 dark:border-amber-900/70 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-800'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-xs font-bold text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">{index + 1}</span>
                  <div><p className="text-sm font-semibold text-slate-950 dark:text-white">المنشور {index + 1}</p><p className="text-xs text-slate-500 dark:text-slate-400">مراجعة مستقلة قبل النشر</p></div>
                </div>
                <Badge variant={isApproved ? 'success' : needsReview ? 'warning' : 'info'} dot>{isApproved ? t('assistant.workspace.quality.passed') : needsReview ? t('assistant.workspace.quality.review') : t('assistant.workspace.post.generating')}</Badge>
              </div>
              <textarea value={draft.content} onChange={(e) => updateDraft(draft.local_id, { content: e.target.value })} rows={4} className="mt-4 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100" />
              <QualityMetrics t={t} draft={draft} />
              {!isApproved && <Button variant="outline" size="sm" className="mt-4" onClick={() => regenerateDraft(draft.local_id)} loading={draft.generating}><RefreshCw className="h-3.5 w-3.5" /> {t('assistant.review.regenerate')}</Button>}
            </div>
          );
        })}
        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end dark:border-slate-800">
          <Button variant="outline" onClick={resetPipeline}>{t('assistant.review.discard')}</Button>
          <Button onClick={proceedFromQuality} disabled={drafts.length === 0 || !drafts.every((draft) => draft.approved)}><CheckCircle2 className="h-4 w-4" /> {t('assistant.quality.continue')}</Button>
        </div>
      </div>
    </Card>
  );
}

function QualityMetrics({ t, draft }: { t: (key: string, params?: Record<string, string | number>) => string; draft: DraftPost }) {
  const quality = draft.quality;
  const metrics = [
    { label: t('assistant.workspace.quality.content'), value: quality?.score },
    { label: t('assistant.workspace.quality.language'), value: quality?.arabic_quality },
    { label: t('assistant.workspace.quality.brand'), value: quality?.brand_fit ?? quality?.brand_score },
    { label: t('assistant.workspace.quality.platform'), value: quality?.linkedin_fit ?? quality?.platform_score },
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {metrics.map((metric) => {
        const value = typeof metric.value === 'number' ? metric.value : null;
        return (
          <div key={metric.label} className="rounded-xl bg-white/80 p-3 dark:bg-slate-900/70">
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400"><span>{metric.label}</span><span className="font-semibold text-slate-800 dark:text-slate-200">{value === null ? '—' : value}</span></div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${value === null ? 'bg-slate-200 dark:bg-slate-700' : value >= 90 ? 'bg-emerald-500' : value >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${value === null ? 0 : Math.min(100, value)}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

function ReviewAndSchedulePanel({
  t,
  drafts,
  connectedPlatforms,
  updateDraft,
  removeDraft,
  togglePlatform,
  regenerateDraft,
  resetPipeline,
  approveAndSchedule,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  drafts: DraftPost[];
  connectedPlatforms: string[];
  updateDraft: (localId: string, patch: Partial<DraftPost>) => void;
  removeDraft: (localId: string) => void;
  togglePlatform: (localId: string, platform: string) => void;
  regenerateDraft: (localId: string) => void;
  resetPipeline: () => void;
  approveAndSchedule: () => void;
}) {
  return (
    <Card title={t('assistant.review.title')} description="النتيجة النهائية التي ستنتقل إلى جدول النشر." className="rounded-2xl border-slate-200/80 shadow-subtle dark:border-slate-800">
      {drafts.length === 0 ? <EmptyState icon={<Wand2 className="h-10 w-10" />} title={t('assistant.review.empty.title')} description={t('assistant.review.empty.description')} /> : (
        <div className="space-y-4">
          {drafts.map((draft, index) => <ReviewPostCard key={draft.local_id} t={t} draft={draft} index={index} connectedPlatforms={connectedPlatforms} updateDraft={updateDraft} removeDraft={removeDraft} togglePlatform={togglePlatform} regenerateDraft={regenerateDraft} />)}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end dark:border-slate-800">
            <Button variant="outline" onClick={resetPipeline}>{t('assistant.review.discard')}</Button>
            <Button onClick={approveAndSchedule} disabled={drafts.length === 0}><Send className="h-4 w-4" /> {t('assistant.review.approve')}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function ReviewPostCard({
  t,
  draft,
  index,
  connectedPlatforms,
  updateDraft,
  removeDraft,
  togglePlatform,
  regenerateDraft,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  draft: DraftPost;
  index: number;
  connectedPlatforms: string[];
  updateDraft: (localId: string, patch: Partial<DraftPost>) => void;
  removeDraft: (localId: string) => void;
  togglePlatform: (localId: string, platform: string) => void;
  regenerateDraft: (localId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4 sm:p-5 dark:border-slate-800">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">المنشور {index + 1}</p><p className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">جاهز للمراجعة والجدولة</p></div>
        <div className="flex items-center gap-1"><Button variant="ghost" size="sm" onClick={() => regenerateDraft(draft.local_id)} loading={draft.generating} aria-label={t('assistant.review.regenerate')}><RefreshCw className="h-3.5 w-3.5" /></Button><Button variant="ghost" size="sm" onClick={() => removeDraft(draft.local_id)} aria-label={t('assistant.review.discard')}><Trash2 className="h-3.5 w-3.5" /></Button></div>
      </div>
      <textarea value={draft.content} onChange={(e) => updateDraft(draft.local_id, { content: e.target.value, validationFailed: false })} rows={5} className="mt-4 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm leading-6 text-slate-900 focus:border-sky-400 focus:outline-none focus:ring-4 focus:ring-sky-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100" />
      {draft.media_urls[0] && <div className="mt-3 flex items-center gap-3"><img src={draft.media_urls[0]} alt="" className="h-16 w-16 rounded-xl object-cover" /><Button variant="ghost" size="sm" onClick={() => updateDraft(draft.local_id, { media_urls: [] })}><X className="h-3.5 w-3.5" /> {t('assistant.review.removeImage')}</Button></div>}
      {draft.validationFailed && <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><p className="font-semibold">{t('assistant.validation.failedTitle')}</p><p className="mt-1">{draft.validationReasons?.join('، ')}</p><p className="mt-2">{t('assistant.validation.mustFixOrRegenerate')}</p></div>}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div>
          <div className="flex flex-wrap items-center gap-2"><Badge variant={draft.quality ? qcBadgeVariant(draft.quality.score) : 'default'}>{draft.quality ? `${t('assistant.workspace.post.quality')} ${draft.quality.score}/100` : t('assistant.workspace.quality.review')}</Badge>{draft.approved && <Badge variant="success" dot>{t('assistant.quality.approved')}</Badge>}{draft.needsReview && <Badge variant="warning" dot>{t('assistant.quality.needsManualReview')}</Badge>}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">{(connectedPlatforms.length ? connectedPlatforms : ALL_PLATFORMS).map((platform) => { const Icon = getPlatformMeta(platform)?.icon ?? Link2; const active = draft.platforms.includes(platform); return <button key={platform} type="button" onClick={() => togglePlatform(draft.local_id, platform)} className={`press-effect flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${active ? 'border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-slate-950' : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'}`}><Icon className="h-3 w-3" /> {platformLabel(t, platform)}</button>; })}</div>
        </div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('assistant.workspace.post.schedule')}<input type="datetime-local" value={toLocalInputValue(draft.scheduled_for)} onChange={(e) => updateDraft(draft.local_id, { scheduled_for: new Date(e.target.value).toISOString() })} className="mt-1.5 block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 focus:border-sky-400 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300" /></label>
      </div>
      {draft.quality && <div className="mt-4"><QualityMetrics t={t} draft={draft} /></div>}
      {draft.platformVariants && draft.platforms.some((platform) => draft.platformVariants?.[platform]) && <div className="mt-4 space-y-2"><p className="text-xs font-semibold text-slate-500 dark:text-slate-400">معاينات مكيّفة حسب المنصة</p>{draft.platforms.filter((platform) => draft.platformVariants?.[platform]).map((platform) => <div key={platform} className="rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-950"><p className="font-medium text-slate-700 dark:text-slate-200">{platformLabel(t, platform)}</p><p className="mt-1 whitespace-pre-wrap leading-5 text-slate-500 dark:text-slate-400">{draft.platformVariants?.[platform]}</p></div>)}</div>}
    </div>
  );
}

function CampaignSummary({
  t,
  plan,
  planWarning,
  platformLabel,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  plan: { objective: string; audience: string; platforms: string[]; cadence: string; post_count: number };
  planWarning: string | null;
  platformLabel: (t: (key: string) => string, platform: string) => string;
}) {
  return (
    <Card title={t('assistant.workspace.planMeta')} className="rounded-2xl border-slate-200/80 shadow-subtle dark:border-slate-800">
      {planWarning && <div className="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {planWarning}</div>}
      <dl className="space-y-4">
        <PlanField label="الهدف" value={plan.objective} />
        <PlanField label="الجمهور" value={plan.audience} />
        <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">المنصات</dt><dd className="mt-2 flex flex-wrap gap-1.5">{plan.platforms.map((platform) => <Badge key={platform} variant="info">{platformLabel(t, platform)}</Badge>)}</dd></div>
        <PlanField label="الإيقاع" value={`${plan.cadence} · ${plan.post_count} منشورات`} />
      </dl>
    </Card>
  );
}

function SourcesSummary({ t, usedSources }: { t: (key: string, params?: Record<string, string | number>) => string; usedSources: { source_id: string; source_name: string | null; title: string }[] }) {
  return (
    <Card title={t('assistant.workspace.usedSources')} className="rounded-2xl border-slate-200/80 shadow-subtle dark:border-slate-800">
      <ul className="space-y-3">{usedSources.map((source, index) => <li key={`${source.source_id}-${index}`} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300"><Database className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0 truncate">{source.title}{source.source_name && <span className="text-slate-400"> — {source.source_name}</span>}</span></li>)}</ul>
    </Card>
  );
}

function CompletedCampaignPanel({
  t,
  drafts,
  monitored,
  resetPipeline,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  drafts: DraftPost[];
  monitored: { postId: string; title: string; status: Post['status']; error_message: string | null; verified: boolean }[];
  resetPipeline: () => void;
}) {
  return (
    <Card className="rounded-2xl border-emerald-200/80 shadow-subtle dark:border-emerald-900/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"><CheckCircle2 className="h-6 w-6" /></div><div><h2 className="text-xl font-semibold text-slate-950 dark:text-white">{t('assistant.workspace.completedTitle')}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('assistant.workspace.completedDescription')}</p></div></div>
        <div className="flex items-center gap-2"><Badge variant="success" dot>{t('assistant.workspace.readyPosts', { count: drafts.length })}</Badge><Button variant="outline" size="sm" onClick={resetPipeline}><Plus className="h-3.5 w-3.5" /> {t('assistant.monitor.newCampaign')}</Button></div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">{drafts.map((draft, index) => { const monitoredPost = monitored[index]; return <div key={draft.local_id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"><div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-slate-950 dark:text-white">المنشور {index + 1}</p><Badge variant={monitoredPost ? statusVariant(monitoredPost.status) : 'success'} dot>{monitoredPost ? monitoredPost.status : t('assistant.workspace.post.approved')}</Badge></div><p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">{draft.content}</p><div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">{draft.quality && <span>{t('assistant.workspace.post.quality')}: {draft.quality.score}/100</span>}<span>{new Date(draft.scheduled_for).toLocaleString()}</span></div>{monitoredPost?.verified && <p className="mt-3 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"><ShieldCheck className="h-3.5 w-3.5" /> تم التحقق من النشر</p>}</div>; })}</div>
    </Card>
  );
}

function BottomExecutionBar({
  t,
  completedPosts,
  totalPosts,
  cancelCampaign,
}: {
  t: (key: string, params?: Record<string, string | number>) => string;
  completedPosts: number;
  totalPosts: number;
  cancelCampaign: () => void;
}) {
  return (
    <div className="fixed inset-x-4 bottom-4 z-30 mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-card-hover backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-400"><Loader2 className="h-4 w-4 animate-spin" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{t('assistant.workspace.bottom.running')}</p><p className="text-xs text-slate-500 dark:text-slate-400">{completedPosts} / {totalPosts || 0} مكتمل · تستمر العملية في الخلفية</p></div></div>
        <div className="flex items-center gap-2 sm:shrink-0"><Button variant="ghost" size="sm" disabled title="الإيقاف المؤقت غير متاح أثناء تشغيل الطابور الحالي"><Pause className="h-3.5 w-3.5" /> {t('assistant.workspace.bottom.pause')}</Button><Button variant="outline" size="sm" onClick={cancelCampaign}><X className="h-3.5 w-3.5" /> {t('assistant.workspace.bottom.cancel')}</Button></div>
      </div>
    </div>
  );
}

function PlanField({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt><dd className="mt-1 text-sm leading-6 text-slate-800 dark:text-slate-200">{value}</dd></div>;
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}
