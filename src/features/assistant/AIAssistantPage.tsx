import {
  AlertTriangle,
  Bot,
  Calendar,
  CheckCircle2,
  Database,
  Image as ImageIcon,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  X,
} from 'lucide-react';
import { AUDIENCE_MIN_CONFIDENCE } from '@/engines/aiOrchestrator';
import { Badge, Button, Card, EmptyState } from '@/ui';
import type { Post } from '@/types/social';
import type { AIDecisionLabel } from '@/types/context';
import { PLATFORM_IDS, getPlatformMeta, platformLabelFallback } from '@/constants/platforms';
import { useAssistantPipeline } from './useAssistantPipeline';

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

// Arabic Content Quality Control: minimum passing score used only for the
// badge color below (the actual pass bar lives in evaluateContentApproval,
// used inside useAssistantPipeline).
const QC_PASS_SCORE = 90;

function qcBadgeVariant(score: number): 'success' | 'warning' | 'error' {
  if (score >= QC_PASS_SCORE) return 'success';
  if (score >= 70) return 'warning';
  return 'error';
}

// AI Decision Layer (Phase 2, STEP 13/section 24) — badge color per label.
// Purely informational here (see AIDecision doc comment in types/assistant.ts):
// EXECUTE reads as clear, ABORT as the most severe, everything else as a
// pending/needs-attention state.
function aiDecisionBadgeVariant(decision: AIDecisionLabel): 'success' | 'warning' | 'error' | 'info' {
  if (decision === 'EXECUTE') return 'success';
  if (decision === 'ABORT') return 'error';
  if (decision === 'HUMAN_REVIEW') return 'warning';
  return 'info';
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
            <PipelineStep
              icon={Users}
              label={t('assistant.stage.audience')}
              active={stage === 'audience'}
              done={!['planning', 'audience'].includes(stage)}
            />
            {plan?.use_content_sources && (
              <>
                <StepConnector />
                <PipelineStep
                  icon={Database}
                  label={t('assistant.stage.collecting')}
                  active={stage === 'collecting'}
                  done={!['planning', 'audience', 'collecting'].includes(stage)}
                />
              </>
            )}
            <StepConnector />
            <PipelineStep
              icon={Wand2}
              label={t('assistant.stage.creating')}
              active={stage === 'creating'}
              done={!['planning', 'audience', 'collecting', 'creating'].includes(stage)}
            />
            <StepConnector />
            {/* Quality Review — its own step, between إنشاء المحتوى and
                تحضير النشر. Never merged into the "creating" step. */}
            <PipelineStep
              icon={ShieldCheck}
              label={t('assistant.stage.quality')}
              active={stage === 'quality'}
              done={['preparing', 'review', 'scheduling', 'monitoring'].includes(stage)}
            />
            <StepConnector />
            <PipelineStep
              icon={Calendar}
              label={t('assistant.stage.publishing')}
              active={stage === 'preparing' || stage === 'scheduling'}
              done={stage === 'review' || stage === 'monitoring'}
            />
          </div>
          {stage === 'audience' && !audienceInference && (
            <p className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('assistant.stage.audienceHint')}
            </p>
          )}
          {stage === 'collecting' && (
            <p className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="h-3 w-3 animate-spin" /> {t('assistant.stage.collectingHint')}
            </p>
          )}
          {stage === 'creating' && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {creatingProgress.total > 0 && (
                <span>{t('assistant.stage.creatingProgress', { done: creatingProgress.done, total: creatingProgress.total })}</span>
              )}
              {creationPhase && (
                <Badge variant={creationPhase === 'approved' ? 'success' : creationPhase === 'rechecking' ? 'warning' : 'info'} dot>
                  {t(`assistant.stage.creationPhase.${creationPhase}`)}
                </Badge>
              )}
            </div>
          )}
          {stage === 'quality' && (
            <p className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              {drafts.length > 0 && drafts.every((d) => d.approved) ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
              )}
              {t('assistant.stage.qualityHint')}
            </p>
          )}
        </Card>
      )}

      {/* Audience Inference card — one-tap "اعتماد" to accept the AI's
          suggested Target Audience, or "تغيير" to override it with free
          text. Pipeline pauses on 'audience' until one of the two is used. */}
      {stage === 'audience' && audienceInference && (
        <Card title={t('assistant.audience.title')} description={t('assistant.audience.description')}>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-950 dark:text-sky-400">
              <Users className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              {!audienceEditing ? (
                <>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{audienceInference.audience}</p>
                  {audienceInference.reason && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{audienceInference.reason}</p>
                  )}
                  <div className="mt-2">
                    {audienceInference.confidence < AUDIENCE_MIN_CONFIDENCE ? (
                      <Badge variant="warning" dot>{t('assistant.audience.needsReview')}</Badge>
                    ) : (
                      <Badge variant="success" dot>{t('assistant.audience.suggested')}</Badge>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={approveAudience}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t('assistant.audience.approve')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAudienceDraft(audienceInference.audience);
                        setAudienceEditing(true);
                      }}
                    >
                      {t('assistant.audience.change')}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={audienceDraft}
                    onChange={(e) => setAudienceDraft(e.target.value)}
                    placeholder={t('assistant.audience.placeholder')}
                    autoFocus
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={confirmAudienceEdit} disabled={!audienceDraft.trim()}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> {t('assistant.audience.confirm')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setAudienceEditing(false)}>
                      {t('assistant.audience.cancel')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {usedSources.length > 0 && stage !== 'idle' && (
        <Card title={t('assistant.sources.title')} description={t('assistant.sources.description')}>
          <ul className="space-y-1.5">
            {usedSources.map((s, i) => (
              <li key={`${s.source_id}-${i}`} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                <span className="min-w-0 truncate">
                  {s.title}
                  {s.source_name && <span className="text-slate-400"> — {s.source_name}</span>}
                </span>
              </li>
            ))}
          </ul>
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

      {/* مراجعة الجودة — a real, standalone stage between إنشاء المحتوى and
          تحضير النشر, not a check folded inside content generation. Every
          draft here already went through the Content Quality Control pass
          (auto-fix + re-review); this stage surfaces the final per-post
          status and is the only gate that lets a post move on to تحضير
          النشر. There is no way to reach تحضير النشر from here except by
          every draft carrying تم الاعتماد. */}
      {stage === 'quality' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('assistant.quality.stage.title')}</h2>
            <Badge variant="default">{t('assistant.review.count', { count: drafts.length })}</Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('assistant.quality.stage.description')}</p>

          <div className="space-y-4">
            {drafts.map((draft, idx) => {
              const qualityStatus: 'pending' | 'needsEdit' | 'approved' = draft.generating
                ? 'pending'
                : draft.approved
                  ? 'approved'
                  : 'needsEdit';
              return (
                <Card key={draft.local_id}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {t('assistant.review.postLabel', { index: idx + 1 })}
                    </span>
                    {qualityStatus === 'pending' && (
                      <Badge variant="info" dot>
                        {t('assistant.quality.status.pending')}
                      </Badge>
                    )}
                    {qualityStatus === 'needsEdit' && (
                      <Badge variant="warning" dot>
                        {t('assistant.quality.status.needsEdit')}
                      </Badge>
                    )}
                    {qualityStatus === 'approved' && (
                      <Badge variant="success" dot>
                        {t('assistant.quality.status.approved')}
                      </Badge>
                    )}
                  </div>

                  {/* النسخة النهائية للمنشور بعد المراجعة. */}
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t('assistant.quality.finalVersion')}
                  </p>
                  <textarea
                    value={draft.content}
                    onChange={(e) => updateDraft(draft.local_id, { content: e.target.value })}
                    rows={4}
                    className="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />

                  {draft.quality && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Badge variant={qcBadgeVariant(draft.quality.score)}>
                        {t('assistant.quality.contentScore')} {draft.quality.score}/100
                      </Badge>
                      {typeof draft.quality.arabic_quality === 'number' && (
                        <Badge variant="default">{t('assistant.quality.arabic')} {draft.quality.arabic_quality}</Badge>
                      )}
                      {draft.quality.issues.length > 0 && qualityStatus !== 'approved' && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">{draft.quality.issues.join('، ')}</span>
                      )}
                    </div>
                  )}

                  {qualityStatus === 'needsEdit' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => regenerateDraft(draft.local_id)}
                      loading={draft.generating}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> {t('assistant.review.regenerate')}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="outline" onClick={resetPipeline}>
              {t('assistant.review.discard')}
            </Button>
            <Button onClick={proceedFromQuality} disabled={drafts.length === 0 || !drafts.every((d) => d.approved)}>
              <CheckCircle2 className="h-4 w-4" /> {t('assistant.quality.continue')}
            </Button>
          </div>
        </div>
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

                  {/* POST CONTENT — the exact text that will be saved as posts.content.
                      Nothing else (quality, platform, schedule, status) is ever mixed in here. */}
                  <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t('assistant.review.contentSection')}
                  </p>
                  <textarea
                    value={draft.content}
                    onChange={(e) => updateDraft(draft.local_id, { content: e.target.value, validationFailed: false })}
                    rows={4}
                    className="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />

                  {draft.media_urls[0] && (
                    <div className="mt-3 flex items-center gap-3">
                      <img src={draft.media_urls[0]} alt="" className="h-16 w-16 rounded-lg object-cover" />
                      <Button variant="ghost" size="sm" onClick={() => updateDraft(draft.local_id, { media_urls: [] })}>
                        <X className="h-3.5 w-3.5" /> {t('assistant.review.removeImage')}
                      </Button>
                    </div>
                  )}

                  {draft.validationFailed && (
                    <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
                      <p className="font-medium">{t('assistant.validation.failedTitle')}</p>
                      {draft.validationReasons && draft.validationReasons.length > 0 && (
                        <p className="mt-1 text-rose-600 dark:text-rose-400">{draft.validationReasons.join(', ')}</p>
                      )}
                      <p className="mt-2 text-rose-600 dark:text-rose-400">{t('assistant.validation.mustFixOrRegenerate')}</p>
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => regenerateDraft(draft.local_id)}>
                        <RefreshCw className="h-3.5 w-3.5" /> {t('assistant.review.regenerate')}
                      </Button>
                    </div>
                  )}

                  {/* Quality — informational, separate from both the content and the publishing details. */}
                  {draft.quality && (
                    <>
                      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {t('assistant.review.qualitySection')}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant={qcBadgeVariant(draft.quality.score)}>
                          {t('assistant.quality.contentScore')} {draft.quality.score}/100
                        </Badge>
                        {typeof draft.quality.arabic_quality === 'number' && (
                          <Badge variant="default">{t('assistant.quality.arabic')} {draft.quality.arabic_quality}</Badge>
                        )}
                        {typeof draft.quality.linkedin_fit === 'number' && (
                          <Badge variant="default">{t('assistant.quality.linkedinFit')} {draft.quality.linkedin_fit}</Badge>
                        )}
                        {typeof draft.quality.brand_fit === 'number' && (
                          <Badge variant="default">{t('assistant.quality.brandFit')} {draft.quality.brand_fit}</Badge>
                        )}
                        {draft.approved && (
                          <Badge variant="success" dot>
                            {t('assistant.quality.approved')}
                          </Badge>
                        )}
                        {draft.needsReview && (
                          <Badge variant="warning" dot>
                            {t(draft.quality_error ? 'assistant.quality.qcUnavailable' : 'assistant.quality.needsManualReview')}
                          </Badge>
                        )}
                      </div>
                    </>
                  )}
                  {!draft.quality && draft.needsReview && (
                    <div className="mt-4 flex flex-wrap items-center gap-1.5">
                      <Badge variant="warning" dot>{t('assistant.quality.needsManualReview')}</Badge>
                    </div>
                  )}

                  {/* AI Decision Layer — Phase 2, STEP 13/14 (section 24/29).
                      Purely informational/traceable: does not gate scheduling,
                      see AIDecision's doc comment in types/assistant.ts. */}
                  {draft.aiDecision && (
                    <>
                      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {t('assistant.review.aiDecisionSection')}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant={aiDecisionBadgeVariant(draft.aiDecision.decision)} dot>
                          {t(`assistant.aiDecision.label.${draft.aiDecision.decision}`)}
                        </Badge>
                        <Badge variant="default">
                          {t('assistant.aiDecision.confidence', { value: Math.round(draft.aiDecision.confidence * 100) })}
                        </Badge>
                        <Badge variant="default">
                          {t(`assistant.aiDecision.risk.${draft.aiDecision.risk}`)}
                        </Badge>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{draft.aiDecision.reason}</span>
                      </div>
                    </>
                  )}

                  {/* Platform Adaptation Engine preview — Phase 2, STEP 10/14
                      (section 16/29). Read-only: the Master Content in the
                      textarea above is still what's actually saved/published
                      for every platform (see DraftPost.platformVariants doc
                      comment) — this is only a preview of the per-platform
                      adapted version when one exists. */}
                  {draft.platformVariants && draft.platforms.some((p) => draft.platformVariants?.[p]) && (
                    <>
                      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        {t('assistant.review.platformPreviewSection')}
                      </p>
                      <div className="mt-1.5 space-y-2">
                        {draft.platforms
                          .filter((p) => draft.platformVariants?.[p])
                          .map((p) => (
                            <div key={p} className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800">
                              <p className="mb-1 font-medium text-slate-600 dark:text-slate-300">{platformLabel(t, p)}</p>
                              <p className="whitespace-pre-wrap text-slate-500 dark:text-slate-400">{draft.platformVariants![p]}</p>
                            </div>
                          ))}
                      </div>
                    </>
                  )}

                  {/* Publishing — platform, account/schedule, status. Never mixed with the post content or the quality metrics above. */}
                  <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {t('assistant.review.publishingSection')}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-4">
                    <div className="flex flex-wrap gap-1.5">
                      {(connectedPlatforms.length ? connectedPlatforms : ALL_PLATFORMS).map((p) => {
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
                  <div className="flex shrink-0 items-center gap-2">
                    {m.verified && (
                      <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="h-3.5 w-3.5" /> {t('assistant.monitor.verified')}
                      </span>
                    )}
                    <Badge variant={statusVariant(m.status)} dot>
                      {t(`post.status.${m.status}`)}
                    </Badge>
                  </div>
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
