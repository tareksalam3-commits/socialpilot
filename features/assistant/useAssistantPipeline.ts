import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { useAISettings } from '@/hooks/useAISettings';
import { useAccounts } from '@/hooks/useAccounts';
import { useMedia } from '@/hooks/useMedia';
import { usePosts } from '@/hooks/usePosts';
import { publishingService } from '@/services/publishingService';
import { persistGeneratedContent, updateGeneratedContent } from '@/services/contentPersistence';
import { contentGenerationJobRepository, type PersistedCampaignJob } from '@/repositories/contentGenerationJobRepository';
import { conversationRepository, messageRepository } from '@/repositories/conversationRepository';
import { contentCharacteristicsRepository } from '@/repositories/contentCharacteristicsRepository';
import { buildContentCharacteristics } from '@/engines/contentEngine/contentCharacteristics';
import { buildOptimizationContext, renderOptimizationContextBlock } from '@/engines/contentEngine/optimizationContext';
import { supabase } from '@/services/supabase';
import {
  runPlannerAgent,
  runAudienceInferenceAgent,
  runCreatorAgent,
  runRewriteAgent,
  reviewGeneratedContent,
  computeScheduleTimes,
  findMatchingMedia,
  generateDraftImage,
  collectContentContext,
  verifyPost,
  sanitizeGeneratedContent,
  evaluateContentApproval,
  validateFinalPostContent,
  isLinkedInPlatform,
  buildWorkspaceContext,
  runStrategyAgent,
  runResearchDecision,
  runResearchAgent,
  runHookAgent,
  runPlatformAdaptationAgent,
  evaluateAIDecision,
  recordAIDecision,
} from '@/engines/aiOrchestrator';
import { resolveWorkspaceDialect } from '@/constants/dialects';
import type {
  CampaignPlan,
  DraftPost,
  AssistantStage,
  MonitoredPost,
  UsedContentSource,
  ContentQualityResult,
  AudienceInference,
} from '@/types/assistant';
import type { WorkspaceContext, ContentStrategy, ResearchResult, HookCandidate, AIDecision } from '@/types/context';
import type { Post } from '@/types/social';

// Arabic Content Quality Control: the maximum number of generate-then-review
// attempts before showing the best version with a "Needs Review" badge
// instead of looping forever. (The pass-score threshold used for the badge
// color in the UI lives in the page component, next to qcBadgeVariant.)
const MAX_QC_ATTEMPTS = 3;

// How many posts within the same campaign the Creator/QC/Image/Platform-
// Adaptation pipeline runs at once. Previously every post in a campaign was
// generated one after another (a full author→QC→image→adapt round trip
// each), so an 8-post campaign could take minutes. A small pool keeps
// several posts in flight together — enough to meaningfully cut wall-clock
// time — without hammering the provider chain hard enough to trip
// per-provider rate limits the way full unlimited parallelism would.
const CREATION_CONCURRENCY = 3;

function deriveTitle(content: string): string {
  const firstLine = content.split('\n').find((l) => l.trim().length > 0) ?? content;
  return firstLine.trim().slice(0, 80);
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `draft-${Date.now()}-${localIdCounter}`;
}

/** Runs `task` for each index in [0, count) with at most `concurrency`
 * running at once, calling `onSettled` as each one finishes (in whatever
 * order they complete, not necessarily index order) so callers can update
 * progressive UI state immediately rather than waiting for the whole batch.
 * A cheap hand-rolled pool instead of a dependency: grab the next index,
 * await it, repeat, with `concurrency` of these workers running together. */
async function runWithConcurrency<T>(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<T>,
  onSettled: (index: number, result: T) => void,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < count) {
      const index = cursor++;
      const result = await task(index);
      onSettled(index, result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, count) }, () => worker()));
}

/** Owns every piece of state and every pipeline step (Planner → Audience
 * Inference → User Approval → Content Generation → Quality Control →
 * Preview → Schedule/Publish) for the AI Assistant page. Kept separate from
 * AIAssistantPage.tsx so the component itself stays presentational (JSX
 * only) — this hook is the whole "brain". */
export function useAssistantPipeline() {
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
  // Audience Inference: the AI's per-post suggestion, awaiting one-tap User
  // Approval (or a free-text change) before Content Generation starts.
  const [audienceInference, setAudienceInference] = useState<AudienceInference | null>(null);
  const [audienceEditing, setAudienceEditing] = useState(false);
  const [audienceDraft, setAudienceDraft] = useState('');
  const [creatingProgress, setCreatingProgress] = useState({ done: 0, total: 0 });
  const [drafts, setDrafts] = useState<DraftPost[]>([]);
  const [monitored, setMonitored] = useState<MonitoredPost[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [campaignJobId, setCampaignJobId] = useState<string | null>(null);
  const [usedSources, setUsedSources] = useState<UsedContentSource[]>([]);
  const contentTextRef = useRef<string | null>(null);
  const runIdRef = useRef(0);
  // Holds the plan across the "audience" pause point — state updates are
  // async, so the plan used to resume the pipeline is read from here rather
  // than risking a stale closure over `plan`.
  const planRef = useRef<CampaignPlan | null>(null);
  // Phase 2 — STEP 5 (AI Orchestrator Context Layer): the structured
  // WorkspaceContext for the current run, built once up front so every
  // agent added in later steps (Strategy, Content, Hook...) can read it
  // from here instead of re-querying repositories itself. Ref rather than
  // state since nothing in the UI renders from it directly yet.
  const workspaceContextRef = useRef<WorkspaceContext | null>(null);
  // Phase 2 — STEP 6 (Strategy Agent): the structured ContentStrategy for
  // the current run, built once the user-approved audience is final (right
  // as Content Generation is about to start). Same fire-and-forget
  // contract as workspaceContextRef — nothing downstream reads it yet
  // (that's STEP 8, Content Agent), so a failure here never blocks
  // generation and is silent by design.
  const strategyRef = useRef<ContentStrategy | null>(null);
  // Phase 2 — STEP 7 (Research Decision + Research Agent): set right after
  // the Strategy Agent, same fire-and-forget contract — nothing downstream
  // reads it yet (STEP 8, Content Agent). null while research isn't
  // required/hasn't resolved; once resolved it's always a full
  // ResearchResult, including the `research_required: false` case, so a
  // later consumer can tell "not needed" apart from "hasn't run yet".
  const researchRef = useRef<ResearchResult | null>(null);
  // Phase 2 — STEP 9 (Hook Agent): the deterministically-selected winning
  // HookCandidate for the current run, built right alongside Strategy
  // (both only need WorkspaceContext, never Research/content itself) and
  // awaited before Content Generation for the same reason Strategy is:
  // STEP 8's Content Agent is the first consumer, so it needs the real
  // result, not whatever happened to resolve in the background. Same
  // fire-and-forget-safe contract as every other optional context ref here
  // — a Hook Agent failure leaves this null and Content Generation proceeds
  // exactly as it did before STEP 9 existed.
  const hookRef = useRef<HookCandidate | null>(null);
  // Phase 3, STEP 9 — Optimization Context. Built once per run (like
  // strategy/hook/research), scoped to this run's platforms.
  const optimizationContextRef = useRef<string | null>(null);

  const connectedPlatforms = useMemo(
    () => Array.from(new Set(accounts.filter((a) => a.status === 'connected').map((a) => a.platform))),
    [accounts],
  );

  // free_only_mode now actually reaches every agent (previously every
  // agent hardcoded freeOnly: true regardless of this setting — a Super
  // Admin who paid for a provider/model was silently still getting only
  // the free tier). Defaults to true when unset, same as before.
  const aiParams = useMemo(
    () => ({ model: settings?.default_model, temperature: settings?.temperature, maxTokens: settings?.max_tokens, freeOnly: settings?.free_only_mode }),
    [settings?.default_model, settings?.temperature, settings?.max_tokens, settings?.free_only_mode],
  );

  // Quality Control Model Separation: QC always resolves through
  // ai_settings.qc_model (never default_model) — reviewGeneratedContent
  // additionally passes the exact authoring model as excludeModel per call,
  // so this is the "preferred QC model" half of the guarantee, not the only
  // one. See qualityControl.ts / taskRouter.ts for the full contract.
  const qcAiParams = useMemo(
    () => ({ model: settings?.qc_model ?? undefined, maxTokens: settings?.max_tokens, freeOnly: settings?.free_only_mode }),
    [settings?.qc_model, settings?.max_tokens, settings?.free_only_mode],
  );

  // Pipeline: Creator → sanitizeGeneratedContent() (deterministic metadata
  // guard) → arabicNaturalnessGuard() (via evaluateContentApproval) → AI
  // Quality Control → evaluateContentApproval(). Never trusts `score` or
  // the AI's own `approved` flag alone — every condition in
  // evaluateContentApproval must hold. Loops up to MAX_QC_ATTEMPTS total;
  // if none pass, the best-scoring attempt is kept and surfaced as "Needs
  // Manual Review" — never presented as approved/high-quality. A QC
  // failure (network/parse error) is NOT treated as approval: it's
  // recorded as quality_error and always needs manual review.
  const generateWithQualityControl = useCallback(
    async (
      planForPost: CampaignPlan,
      index: number,
      contentSourceText: string | null,
    ): Promise<{
      content: string;
      quality: ContentQualityResult | null;
      needsReview: boolean;
      approved: boolean;
      quality_error: boolean;
      genError: string | null;
    }> => {
      if (!workspace) {
        return { content: '', quality: null, needsReview: false, approved: false, quality_error: false, genError: 'no workspace' };
      }
      const linkedInTarget = isLinkedInPlatform(planForPost.platforms);
      const dialect = resolveWorkspaceDialect(workspace);
      let genError: string | null = null;
      let best: { content: string; quality: ContentQualityResult | null; score: number } | null = null;
      let approved = false;
      // Phase 2, STEP 12 (Smart Rewrite, section 22) — the last attempt
      // that actually made it through the sanitizer (so it's real,
      // reviewable prose, never a metadata-leak blob) plus the reasons
      // evaluateContentApproval gave for rejecting it. This is what gets
      // fed to the Rewrite Task — kept separate from `best` because `best`
      // may briefly hold an unsanitized/garbled candidate right after a
      // sanitizer failure, which is never something to rewrite from.
      let lastRewriteInput: { content: string; quality: ContentQualityResult | null } | null = null;
      let lastReasons: string[] = [];

      for (let attempt = 0; attempt < MAX_QC_ATTEMPTS; attempt++) {
        // Attempt 0 always uses the full Creator Agent (nothing to rewrite
        // yet). Every retry after a QC failure uses the Rewrite Task
        // instead of a blind re-roll of the Creator — section 22: "لا تولد
        // نسخة عشوائية جديدة"، أرسل Original Content + Quality Report +
        // Failed Dimensions + Brand DNA + Audience + Platform Rules إلى
        // Rewrite Task. Falls back to the Creator when there's no clean
        // prior content to rewrite yet (attempt 0 itself failed to
        // generate, or every attempt so far was stripped by the sanitizer).
        const gen = lastRewriteInput
          ? await runRewriteAgent(
              workspace.id,
              lastRewriteInput.content,
              lastRewriteInput.quality,
              lastReasons,
              planForPost.platforms,
              aiParams,
              workspaceContextRef.current,
              dialect,
            )
          : await runCreatorAgent(
              workspace.id,
              planForPost,
              index,
              aiParams,
              contentSourceText,
              requestText,
              dialect,
              workspaceContextRef.current,
              strategyRef.current,
              researchRef.current,
              hookRef.current,
              optimizationContextRef.current,
            );
        genError = gen.error;
        if (!gen.content) break; // generation/rewrite itself failed — nothing to sanitize/review

        // Deterministic Content Sanitizer — runs BEFORE Quality Control.
        // Heavy metadata leakage isn't safely fixable by silent cleanup,
        // so it's treated as a failed attempt and regenerated (via the
        // Creator, not the Rewrite Task — there's no clean prior text to
        // target-fix) instead.
        const sanitized = sanitizeGeneratedContent(gen.content);
        if (sanitized.action === 'regenerate') {
          if (!best) best = { content: sanitized.content, quality: null, score: -1 };
          continue;
        }
        const content = sanitized.content;

        const qc = await reviewGeneratedContent(workspace.id, content, planForPost.platforms, requestText, qcAiParams, dialect, gen.model);
        const quality = qc.result;
        const decision = evaluateContentApproval(content, quality, linkedInTarget);
        lastReasons = decision.reasons;
        lastRewriteInput = { content, quality };
        const score = quality?.score ?? -1;
        if (!best || score > best.score) best = { content, quality, score };

        if (decision.approved) {
          approved = true;
          best = { content, quality, score };
          break;
        }
        // else: below the quality bar (or QC unavailable/guard failed) —
        // loop and rewrite (up to MAX_QC_ATTEMPTS total)
      }

      const content = best?.content ?? '';
      const quality = best?.quality ?? null;
      const quality_error = !approved && !!content && !quality;
      const needsReview = !!content && !approved;
      return { content, quality, needsReview, approved, quality_error, genError };
    },
    [workspace, aiParams, qcAiParams, requestText],
  );

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
          // Verified step: confirm every platform target actually stored a
          // platform post ID before showing the "Verified" badge — reuses
          // the same post_platform_targets rows the Publishing Engine wrote.
          verifyPost(updated.id)
            .then((ok) => {
              if (!ok) return;
              setMonitored((cur) => cur.map((m) => (m.postId === updated.id ? { ...m, verified: true } : m)));
            })
            .catch(() => {});
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

  const applyPersistedCampaign = useCallback(async (job: PersistedCampaignJob) => {
    setCampaignJobId(job.id);
    setRequestText(job.request_text);
    setImagesEnabled(job.images_enabled);
    setPlan(job.plan);
    planRef.current = job.plan;
    setAudienceInference(job.audience_inference);
    setAudienceDraft(job.audience_inference?.audience ?? job.plan.audience ?? '');
    setConversationId(job.conversation_id);
    setUsedSources(job.used_sources);
    setCreatingProgress({ done: job.next_index, total: job.post_count });

    const restoredPosts = await contentGenerationJobRepository.generatedPosts(job.workspace_id, job.id);
    setDrafts(restoredPosts.map((post, index) => {
      const metadata = post.metadata as Record<string, unknown>;
      const assistant = (metadata.assistant ?? {}) as Record<string, unknown>;
      const quality = (assistant.quality ?? null) as ContentQualityResult | null;
      return {
        local_id: `persisted-${post.id}`,
        post_id: post.id,
        content: post.content,
        platforms: post.platforms,
        scheduled_for: post.scheduled_for ?? job.schedule_times[index] ?? new Date().toISOString(),
        media_urls: post.media_urls,
        quality,
        needsReview: assistant.needs_review === true,
        approved: assistant.approved === true,
        quality_error: assistant.quality_error === true,
        reviewedContent: post.content,
        platformVariants: (assistant.platform_variants ?? undefined) as Record<string, string> | undefined,
      };
    }));

    if (job.status === 'completed' || job.phase === 'review' || job.phase === 'completed') setStage('review');
    else if (job.phase === 'collecting') setStage('collecting');
    else if (job.phase === 'audience') setStage('audience');
    else setStage('creating');
  }, []);

  useEffect(() => {
    if (!workspace || !user) return;
    let cancelled = false;
    const restore = async () => {
      try {
        const job = await contentGenerationJobRepository.latestActive(workspace.id, user.id);
        if (job && !cancelled) await applyPersistedCampaign(job);
      } catch (error) {
        console.error('assistant campaign restore failed', error);
      }
    };
    void restore();
    const timer = window.setInterval(() => void restore(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [workspace, user, applyPersistedCampaign]);

  const enqueuePersistentCampaign = useCallback(async (planForRun: CampaignPlan, finalAudience: AudienceInference | null) => {
    if (!workspace || !user) return;
    const scheduleTimes = computeScheduleTimes(planForRun, planForRun.post_count).map((value) => value.toISOString());
    // Move immediately out of the audience step. This hides the approval action
    // while the durable queue record is being created and prevents duplicate jobs.
    setStage('creating');
    setCreatingProgress({ done: 0, total: planForRun.post_count });
    try {
      const job = await contentGenerationJobRepository.enqueue({
        workspaceId: workspace.id,
        userId: user.id,
        requestText,
        plan: planForRun,
        audienceInference: finalAudience,
        imagesEnabled,
        scheduleTimes,
        conversationId,
        aiModel: aiParams.model,
        aiTemperature: aiParams.temperature,
        aiMaxTokens: aiParams.maxTokens,
      });
      await applyPersistedCampaign(job);
    } catch (error) {
      // Queue creation is the only point at which no background work exists yet;
      // return to audience so the user can safely retry the approval.
      setStage('audience');
      push({
        title: t('assistant.toast.saveFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    }
  }, [workspace, user, requestText, imagesEnabled, conversationId, aiParams, applyPersistedCampaign, push, t]);

  const resetPipeline = useCallback(() => {
    // يجب التقاط هذه القيم قبل مسحها من الحالة أدناه، لأننا نحتاجها بعد
    // ذلك لإلغاء الحملة في قاعدة البيانات.
    const jobIdToDiscard = campaignJobId;
    const workspaceId = workspace?.id;

    setStage('idle');
    setPlan(null);
    setPlanWarning(null);
    setAudienceInference(null);
    setAudienceEditing(false);
    setAudienceDraft('');
    setDrafts([]);
    setMonitored([]);
    setConversationId(null);
    setCampaignJobId(null);
    setRequestText('');
    setCreatingProgress({ done: 0, total: 0 });
    setUsedSources([]);
    contentTextRef.current = null;
    planRef.current = null;
    strategyRef.current = null;
    researchRef.current = null;
    hookRef.current = null;
    optimizationContextRef.current = null;

    // مسح الحالة محليًا وحده لا يكفي: طالما بقيت الحملة في قاعدة البيانات
    // بحالة غير "cancelled"، سيعيد الـ useEffect الخاص بـ latestActive (كل
    // 10 ثوانٍ، أو عند إعادة فتح الصفحة) إحضارها وعرضها من جديد في شاشة
    // المراجعة — وهو بالضبط سبب عودة المنشورات بعد الضغط على "تجاهل".
    // لذلك نلغي الحملة فعليًا على الخادم هنا.
    if (jobIdToDiscard && workspaceId) {
      contentGenerationJobRepository.discard(jobIdToDiscard, workspaceId).catch((error) => {
        console.error('assistant campaign discard failed', error);
        push({ title: t('assistant.toast.discardFailed'), variant: 'error' });
      });
    }
  }, [campaignJobId, workspace, push, t]);

  // Phase 2 of the pipeline: Content Generation → Quality Control → Preview.
  // Split out so it can run either right after Planning (in principle) or —
  // as actually wired up below — only once the user has approved or edited
  // the Audience Inference suggestion. `planForRun` always carries the
  // final, user-approved audience.
  const runCreationPhase = useCallback(
    async (runId: number, planForRun: CampaignPlan) => {
      if (!workspace) return;

      // 1.75 Strategy Agent (Phase 2, STEP 6) + Research Decision/Agent
      // (STEP 7) — both now AWAITED (no longer fire-and-forget like in
      // STEP 5/6/7's own commits) because STEP 8 (Content Agent, right
      // below) is the first thing that actually reads them: Content
      // Generation needs the real Strategy/Research result, not whatever
      // happened to have resolved in the background by the time it runs.
      // Still fully defensive — either call failing just means Content
      // Generation proceeds with strategy/research as null, exactly like
      // every other optional-context failure in this pipeline.
      strategyRef.current = null;
      researchRef.current = null;
      hookRef.current = null;
      const creationDialect = resolveWorkspaceDialect(workspace);
      try {
        const { strategy } = await runStrategyAgent(workspace.id, planForRun, workspaceContextRef.current, aiParams);
        if (runIdRef.current !== runId) return;
        strategyRef.current = strategy;
      } catch {
        // strategyRef.current stays null — Content Agent below treats a
        // missing strategy the same as a missing Brand Voice: optional
        // context, never a blocker.
      }
      // Hook Agent (Phase 2, STEP 9) — only needs WorkspaceContext +
      // Strategy (just resolved above), never Research/content text, so it
      // runs here rather than after the Content Sources step. Same
      // non-blocking contract: a failure leaves hookRef.current null and
      // the Creator falls back to writing its own opening line.
      try {
        const { result } = await runHookAgent(workspace.id, planForRun, workspaceContextRef.current, strategyRef.current, aiParams, creationDialect);
        if (runIdRef.current !== runId) return;
        hookRef.current = result.best;
      } catch {
        // hookRef.current stays null — same optional-context contract.
      }
      // Phase 3, STEP 9 — Optimization Context. Deterministic, no AI call
      // (see optimizationContext.ts); scoped to this run's platforms so
      // learnings from other platforms never leak in (section 20).
      // Non-blocking like everything else here — an empty context just
      // means no block gets injected into the Creator's prompt.
      try {
        const optimizationContext = await buildOptimizationContext(workspace.id, planForRun.platforms);
        optimizationContextRef.current = renderOptimizationContextBlock(optimizationContext);
      } catch {
        optimizationContextRef.current = null;
      }
      try {
        const { decision } = await runResearchDecision(workspace.id, requestText, planForRun, aiParams);
        if (runIdRef.current !== runId) return;
        if (decision.research_required) {
          researchRef.current = await runResearchAgent(workspace.id, decision, aiParams);
        } else {
          researchRef.current = { research_required: false, research_available: false, evidence: [], sources: [], verified_context: null, reason: decision.reason };
        }
        if (runIdRef.current !== runId) return;
      } catch {
        // researchRef.current stays null — same non-blocking contract.
      }

      // 2. Content Sources step — collect, clean and summarize only when the
      // request implies it. Reuses the Content Sources module end-to-end.
      let contentText: string | null = null;
      if (planForRun.use_content_sources) {
        setStage('collecting');
        const { contentText: text, used, error: sourcesError } = await collectContentContext(workspace.id);
        if (runIdRef.current !== runId) return;
        contentText = text;
        contentTextRef.current = text;
        setUsedSources(used);
        if (sourcesError === 'no_sources') {
          push({ title: t('assistant.toast.noContentSources'), variant: 'error' });
        } else if (sourcesError === 'no_new_items') {
          push({ title: t('assistant.toast.noNewContentItems'), variant: 'error' });
        } else if (sourcesError) {
          push({ title: t('assistant.toast.contentSourcesFailed'), description: sourcesError, variant: 'error' });
        }
      }

      // 3. Creator Agent — automatically chained, no user action needed here.
      // Posts within the campaign now generate in parallel (up to
      // CREATION_CONCURRENCY at once) instead of one full author→QC→
      // image→adapt round trip after another. Placeholders (generating:
      // true, same UI state regenerateDraft already uses for a single
      // draft) go up front so every slot is visible immediately and fills
      // in as it completes, in whatever order that happens to be —
      // `created` stays indexed by post position so the final list the
      // user sees is still in original order regardless.
      setStage('creating');
      setCreatingProgress({ done: 0, total: planForRun.post_count });
      const scheduleTimes = computeScheduleTimes(planForRun, planForRun.post_count);
      const created: DraftPost[] = Array.from({ length: planForRun.post_count }, (_, i) => ({
        local_id: nextLocalId(),
        content: '',
        platforms: planForRun.platforms,
        scheduled_for: scheduleTimes[i].toISOString(),
        media_urls: [],
        generating: true,
      }));
      setDrafts([...created]);
      let doneCount = 0;

      const generateOnePost = async (i: number): Promise<DraftPost> => {
        const { content, quality, needsReview, approved, quality_error, genError } = await generateWithQualityControl(planForRun, i, contentText);
        if (runIdRef.current !== runId) return created[i];
        const finalContent = content || t('assistant.draft.generationFailedPlaceholder');
        if (genError) push({ title: t('assistant.toast.postGenerationIssue', { index: i + 1 }), description: genError, variant: 'error' });
        if (needsReview) push({ title: t('assistant.toast.needsReview', { index: i + 1 }), variant: 'info' });

        // Create Images step: reuse a matching Media Library asset first —
        // only generate a brand-new AI image when nothing already fits.
        let media_urls: string[] = [];
        if (imagesEnabled) {
          const matched = findMatchingMedia(`${planForRun.objective} ${finalContent}`, mediaItems);
          if (matched) {
            media_urls = [matched];
          } else {
            const { url: generatedUrl, error: imageError } = await generateDraftImage(workspace.id, planForRun, finalContent);
            if (runIdRef.current !== runId) return created[i];
            if (generatedUrl) {
              media_urls = [generatedUrl];
            } else if (imageError) {
              push({ title: t('assistant.toast.imageGenerationFailed', { index: i + 1 }), description: imageError, variant: 'error' });
            }
          }
        }

        // Platform Adaptation Engine (Phase 2, STEP 10) — only worth
        // running once there's real, QC'd content to adapt. Best-effort:
        // a failure here just leaves platformVariants empty, and the
        // Master Content (`finalContent`) stays what's shown/published for
        // every platform in `platformForRun.platforms`, same as before
        // this step existed.
        let platformVariants: Record<string, string> | undefined;
        if (content) {
          try {
            const { result } = await runPlatformAdaptationAgent(
              workspace.id,
              finalContent,
              planForRun.platforms,
              workspaceContextRef.current,
              aiParams,
              resolveWorkspaceDialect(workspace),
            );
            if (runIdRef.current !== runId) return created[i];
            platformVariants = Object.keys(result.variants).length ? result.variants : undefined;
          } catch {
            // platformVariants stays undefined — optional context, never a blocker.
          }
        }

        // AI Decision Layer (Phase 2, STEP 13, section 24) — the central
        // task-level verdict for this draft's generation, computed from
        // this draft's own Quality Decision (STEP 11) plus whether Research
        // actually landed when it was required (researchRef.current is the
        // same run-wide ResearchResult passed to the Creator above).
        // Purely informational at this point — see aiDecisionLayer.ts and
        // DraftPost.aiDecision for why it doesn't gate anything yet.
        const aiDecision: AIDecision = evaluateAIDecision('draft_generation', quality, researchRef.current);
        recordAIDecision(workspace.id, aiDecision, {
          contextVersion: workspaceContextRef.current?.context_version,
          qualityScore: quality?.score ?? null,
        }).catch(() => {});

        // Persist immediately after generation and QC. The same `posts` row
        // then travels through editing, review, scheduling and publishing;
        // this avoids a page-local draft that disappears on navigation.
        let persistedPostId: string | undefined;
        try {
          const persisted = await persistGeneratedContent({
            workspaceId: workspace.id,
            title: deriveTitle(finalContent),
            content: finalContent,
            platforms: planForRun.platforms,
            mediaUrls: media_urls,
            scheduledFor: scheduleTimes[i].toISOString(),
            source: 'ai_assistant',
            sourceLabel: 'AI Assistant',
            stage: approved ? 'approved' : 'in_review',
            quality,
            needsReview: needsReview || quality_error,
            platformVariants,
            metadata: {
              assistant: {
                source_request: requestText,
                quality,
                approved: !!approved,
                needs_review: !!needsReview,
                quality_error: !!quality_error,
                platform_variants: platformVariants ?? null,
                ai_decision: aiDecision,
              },
            },
          });
          persistedPostId = persisted.id;
        } catch (persistError) {
          // A visible warning keeps the current review UI usable while making
          // a persistence failure explicit instead of silently losing work.
          push({
            title: t('assistant.toast.saveFailed'),
            description: persistError instanceof Error ? persistError.message : finalContent.slice(0, 60),
            variant: 'error',
          });
        }

        return {
          local_id: created[i].local_id,
          post_id: persistedPostId,
          content: finalContent,
          platforms: planForRun.platforms,
          scheduled_for: scheduleTimes[i].toISOString(),
          media_urls,
          quality,
          needsReview,
          approved,
          quality_error,
          reviewedContent: content ? finalContent : undefined,
          platformVariants,
          aiDecision,
        };
      };

      await runWithConcurrency(planForRun.post_count, CREATION_CONCURRENCY, generateOnePost, (i, draft) => {
        if (runIdRef.current !== runId) return;
        created[i] = draft;
        doneCount += 1;
        setCreatingProgress({ done: doneCount, total: planForRun.post_count });
        setDrafts([...created]);
      });
      if (runIdRef.current !== runId) return;

      // 4. Quality Review — a standalone stage, separate from 'creating'.
      // Every draft above already ran through the Content Quality Control
      // pass (generateWithQualityControl's own auto-fix + re-review loop,
      // up to MAX_QC_ATTEMPTS), so each draft's `approved` flag is already
      // final; this stage's job is only to surface that result clearly and
      // enforce it as a hard gate before the Publisher Agent runs. Pause
      // briefly so the per-draft status (تم الاعتماد / يحتاج تعديل) is
      // actually visible rather than flashing through instantly.
      setStage('quality');
      await new Promise((r) => setTimeout(r, 400));
      if (runIdRef.current !== runId) return;
      if (created.length > 0 && created.every((d) => d.approved)) {
        // مراجعة الجودة ✓ — every draft passed, so (and only so) we're
        // allowed through to Publisher Agent / تحضير النشر.
        setStage('preparing');
        await new Promise((r) => setTimeout(r, 250));
        if (runIdRef.current !== runId) return;
        setStage('review');
      }
      // else: stays on 'quality'. Flagged drafts need a fix — regenerateDraft()
      // (auto-fix + re-review) or a manual edit — and the user must call
      // proceedFromQuality() once every draft is approved. There is no
      // other path from here into 'preparing'.
    },
    [workspace, imagesEnabled, mediaItems, generateWithQualityControl, aiParams, requestText, push, t],
  );

  // Manual continue out of Quality Review once every flagged draft has been
  // fixed. Re-checks the approval condition itself rather than trusting the
  // calling button's disabled state alone — Quality FAIL always blocks the
  // Publisher Agent, with no override.
  const proceedFromQuality = useCallback(async () => {
    if (drafts.length === 0 || !drafts.every((d) => d.approved)) {
      push({ title: t('assistant.quality.blocked'), variant: 'error' });
      return;
    }
    const runId = runIdRef.current;
    setStage('preparing');
    await new Promise((r) => setTimeout(r, 250));
    if (runIdRef.current !== runId) return;
    setStage('review');
  }, [drafts, push, t]);

  // Phase 1 of the pipeline: Planner Agent → Audience Inference, then pauses
  // and waits for the user's one-tap Approve (or free-text Change) on the
  // suggested audience before any content is generated.
  const runPipeline = useCallback(async () => {
    if (!workspace || !user || !requestText.trim()) {
      push({ title: t('assistant.toast.enterRequest'), variant: 'error' });
      return;
    }
    const runId = ++runIdRef.current;
    setDrafts([]);
    setMonitored([]);
    setPlanWarning(null);
    setUsedSources([]);
    setAudienceInference(null);
    setAudienceEditing(false);
    setAudienceDraft('');

    // Best-effort thread so this run shows up alongside Playground
    // conversations in AI History — never blocks the pipeline.
    conversationRepository
      .create({ workspace_id: workspace.id, title: requestText.slice(0, 60) || t('assistant.defaultCampaignTitle'), model: aiParams.model })
      .then((conv) => {
        if (runIdRef.current !== runId) return;
        setConversationId(conv.id);
        messageRepository.create({ conversation_id: conv.id, role: 'user', content: requestText }).catch(() => {});
      })
      .catch(() => {});

    // 0. Context Layer — build the structured WorkspaceContext once for
    // this run (Phase 2, STEP 5). Best-effort: a failure here (e.g. brand
    // voice / audience profile row missing) must never block generation —
    // it just means later agents that read workspaceContextRef fall back
    // to their existing behavior, same as before this step existed.
    workspaceContextRef.current = null;
    buildWorkspaceContext(workspace.id)
      .then((ctx) => {
        if (runIdRef.current !== runId) return;
        workspaceContextRef.current = ctx;
      })
      .catch(() => {
        // Leave workspaceContextRef.current as null — nothing downstream
        // depends on it yet, so this is silent by design.
      });

    // 1. Planner Agent
    setStage('planning');
    const { plan: newPlan, error: plannerError } = await runPlannerAgent(workspace.id, requestText, connectedPlatforms, aiParams);
    if (runIdRef.current !== runId) return;
    setPlan(newPlan);
    planRef.current = newPlan;
    if (plannerError) setPlanWarning(t('assistant.plan.fallbackWarning'));

    // 1.5 Audience Inference Agent — infers who THIS post should target from
    // User Profile + Brand Voice + Post Goal + Post Topic + Post Context,
    // then pauses here for User Approval. The user is never asked to type
    // an audience by hand; one tap on "اعتماد" is enough.
    setStage('audience');
    const { inference, error: audienceError } = await runAudienceInferenceAgent(workspace.id, requestText, newPlan, aiParams);
    if (runIdRef.current !== runId) return;
    setAudienceInference(inference);
    setAudienceDraft(inference.audience);
    if (audienceError) push({ title: t('assistant.audience.toast.failed'), variant: 'info' });
    // Pipeline pauses here — approveAudience()/confirmAudienceEdit() resumes
    // it via runCreationPhase() once the user has approved or edited it.
  }, [workspace, user, requestText, connectedPlatforms, aiParams, push, t]);

  // User Approval: accept the AI's suggestion as-is and move straight into
  // Content Generation.
  const approveAudience = useCallback(async () => {
    if (!planRef.current || !audienceInference) return;
    const updatedPlan = { ...planRef.current, audience: audienceInference.audience };
    planRef.current = updatedPlan;
    setPlan(updatedPlan);
    await enqueuePersistentCampaign(updatedPlan, audienceInference);
  }, [audienceInference, enqueuePersistentCampaign]);

  // "تغيير": lets the user override the suggested audience with free text
  // instead of the AI's guess — still just one field, no audience database.
  const confirmAudienceEdit = useCallback(async () => {
    if (!planRef.current) return;
    const finalAudience = audienceDraft.trim() || planRef.current.audience;
    const updatedPlan = { ...planRef.current, audience: finalAudience };
    const finalInference: AudienceInference = audienceInference
      ? { ...audienceInference, audience: finalAudience }
      : { audience: finalAudience, reason: 'User-selected audience', confidence: 1 };
    planRef.current = updatedPlan;
    setPlan(updatedPlan);
    setAudienceInference(finalInference);
    setAudienceEditing(false);
    await enqueuePersistentCampaign(updatedPlan, finalInference);
  }, [audienceDraft, audienceInference, enqueuePersistentCampaign]);

  const updateDraft = (localId: string, patch: Partial<DraftPost>) => {
    const current = drafts.find((draft) => draft.local_id === localId);
    setDrafts((prev) => prev.map((d) => (d.local_id === localId ? { ...d, ...patch } : d)));

    // Local state keeps the UI responsive; meaningful changes are also saved
    // to the same posts row immediately so a navigation cannot discard work.
    if (!current?.post_id) return;
    const hasWorkflowChange =
      typeof patch.content === 'string' ||
      Array.isArray(patch.platforms) ||
      Array.isArray(patch.media_urls) ||
      typeof patch.scheduled_for === 'string' ||
      patch.quality !== undefined ||
      patch.approved !== undefined ||
      patch.needsReview !== undefined ||
      patch.platformVariants !== undefined;
    if (!hasWorkflowChange) return;

    const content = patch.content ?? current.content;
    const platforms = patch.platforms ?? current.platforms;
    const mediaUrls = patch.media_urls ?? current.media_urls;
    const wasManuallyEdited =
      typeof patch.content === 'string' && patch.content !== current.content && patch.quality === undefined;
    const approved = wasManuallyEdited ? false : patch.approved ?? current.approved ?? false;
    const needsReview = wasManuallyEdited ? true : patch.needsReview ?? current.needsReview ?? false;
    const quality = patch.quality ?? current.quality ?? null;
    const platformVariants = patch.platformVariants ?? current.platformVariants;

    void updateGeneratedContent(current.post_id, {
      title: deriveTitle(content),
      content,
      platforms,
      mediaUrls,
      scheduledFor: patch.scheduled_for ?? current.scheduled_for,
      source: 'ai_assistant',
      sourceLabel: 'AI Assistant',
      stage: wasManuallyEdited ? 'editing' : approved ? 'approved' : 'in_review',
      quality,
      needsReview,
      platformVariants,
      metadata: {
        assistant: {
          quality,
          approved,
          needs_review: needsReview,
          quality_error: patch.quality_error ?? current.quality_error ?? false,
          platform_variants: platformVariants ?? null,
          ai_decision: patch.aiDecision ?? current.aiDecision ?? null,
        },
      },
    }).catch((persistError) => {
      push({
        title: t('assistant.toast.saveFailed'),
        description: persistError instanceof Error ? persistError.message : undefined,
        variant: 'error',
      });
    });
  };

  const removeDraft = (localId: string) => {
    const current = drafts.find((draft) => draft.local_id === localId);
    if (current?.post_id) {
      void updateGeneratedContent(current.post_id, {
        source: 'ai_assistant',
        sourceLabel: 'AI Assistant',
        stage: 'editing',
        status: 'archived',
      }).catch(() => {});
    }
    setDrafts((prev) => prev.filter((d) => d.local_id !== localId));
  };

  const togglePlatform = (localId: string, platform: string) => {
    const current = drafts.find((draft) => draft.local_id === localId);
    if (!current) return;
    const has = current.platforms.includes(platform);
    const platforms = has ? current.platforms.filter((item) => item !== platform) : [...current.platforms, platform];
    updateDraft(localId, { platforms });
  };

  const regenerateDraft = async (localId: string) => {
    if (!workspace || !plan) return;
    const index = drafts.findIndex((d) => d.local_id === localId);
    if (index === -1) return;
    updateDraft(localId, { generating: true });
    const { content, quality, needsReview, approved, quality_error, genError } = await generateWithQualityControl(
      plan,
      index,
      contentTextRef.current,
    );
    if (!content) {
      push({ title: t('assistant.toast.regenerateFailed'), description: genError ?? undefined, variant: 'error' });
      updateDraft(localId, { generating: false });
      return;
    }
    if (needsReview) push({ title: t('assistant.toast.needsReview', { index: index + 1 }), variant: 'info' });

    // Platform Adaptation Engine (Phase 2, STEP 10) — same best-effort
    // refresh as the initial creation loop, against the draft's current
    // platforms (the user may have toggled them via togglePlatform() since
    // the draft was first created), so a manual regenerate never leaves
    // stale variants tied to a platform list that's no longer selected.
    let platformVariants: Record<string, string> | undefined;
    try {
      const currentPlatforms = drafts[index]?.platforms ?? plan.platforms;
      const { result } = await runPlatformAdaptationAgent(
        workspace.id,
        content,
        currentPlatforms,
        workspaceContextRef.current,
        aiParams,
        resolveWorkspaceDialect(workspace),
      );
      platformVariants = Object.keys(result.variants).length ? result.variants : undefined;
    } catch {
      // platformVariants stays undefined — optional context, never a blocker.
    }

    // AI Decision Layer (Phase 2, STEP 13) — recomputed for the regenerated
    // content, same as the initial creation loop. Manual regeneration has
    // no run-wide ResearchResult in scope here (contentTextRef/researchRef
    // are tied to the last full pipeline run, not this one-off redo), so
    // this passes quality only — equivalent to research simply not being
    // required, same conservative default evaluateAIDecision already has.
    const aiDecision: AIDecision = evaluateAIDecision('draft_generation', quality);
    recordAIDecision(workspace.id, aiDecision, {
      contextVersion: workspaceContextRef.current?.context_version,
      qualityScore: quality?.score ?? null,
    }).catch(() => {});

    updateDraft(localId, {
      content,
      quality,
      needsReview,
      approved,
      quality_error,
      reviewedContent: content,
      validationFailed: false,
      generating: false,
      platformVariants,
      aiDecision,
    });
  };

  const approveAndSchedule = async () => {
    if (!workspace || !user || drafts.length === 0) return;
    const invalid = drafts.find((d) => !d.content.trim() || d.platforms.length === 0);
    if (invalid) {
      push({ title: t('assistant.toast.fixDraftsFirst'), variant: 'error' });
      return;
    }

    // Post Content Validator — the last gate before createPost(). Quality
    // FAIL always blocks scheduling: there is no override. A failing draft
    // must be edited (which re-runs this same Final Quality Check) or
    // regenerated before it can be approved.
    const failing = drafts.filter((d) => !validateFinalPostContent(d.content).valid);
    if (failing.length > 0) {
      setDrafts((prev) =>
        prev.map((d) => {
          if (!failing.some((f) => f.local_id === d.local_id)) return d;
          return { ...d, validationFailed: true, validationReasons: validateFinalPostContent(d.content).reasons };
        }),
      );
      push({ title: t('assistant.toast.validationFailed', { count: failing.length }), variant: 'error' });
      return;
    }

    setStage('scheduling');
    const results: MonitoredPost[] = [];
    const now = Date.now();

    for (const draft of drafts) {
      // QC gate before Approval: only re-run when the text actually changed
      // since the last review (manual edit) — never on every small tweak.
      // Purely informational at this point; it's stored on the post but
      // never blocks the user from approving a manually-edited draft (the
      // Post Content Validator above is the hard gate; QC here is
      // informational metadata only, same as before).
      let quality = draft.quality ?? null;
      if (workspace && draft.reviewedContent !== draft.content) {
        const qc = await reviewGeneratedContent(workspace.id, draft.content, draft.platforms, requestText, qcAiParams, resolveWorkspaceDialect(workspace));
        if (qc.result) quality = qc.result;
      }

      // AI Decision Layer (Phase 2, STEP 13) — task-level verdict for the
      // Schedule operation itself, logged for traceability (section 28).
      // Informational only, same as the QC re-check right above: it does
      // not add a new blocking gate here — validateFinalPostContent already
      // ran as the hard gate before this loop started.
      const scheduleDecision: AIDecision = evaluateAIDecision('schedule_post', quality);
      recordAIDecision(workspace.id, scheduleDecision, {
        contextVersion: workspaceContextRef.current?.context_version,
        qualityScore: quality?.score ?? null,
      }).catch(() => {});

      const assistantMetadata = {
        assistant: {
          source_request: requestText,
          quality,
          approved: !!draft.approved,
          needs_review: !!draft.needsReview,
          quality_error: !!draft.quality_error,
          // Phase 2, STEP 10 — Publishing (orchestrator.ts,
          // resolveTargetContent) reads the matching variant per target
          // platform when one exists here, falling back to `content`.
          platform_variants: draft.platformVariants ?? null,
          // Phase 2, STEP 13 — the AI Decision Layer's verdict for this
          // Schedule operation, same traceability purpose.
          ai_decision: scheduleDecision,
        },
      };

      let post: Post | null = null;
      try {
        post = draft.post_id
          ? await updateGeneratedContent(draft.post_id, {
              title: deriveTitle(draft.content),
              content: draft.content,
              platforms: draft.platforms,
              mediaUrls: draft.media_urls,
              scheduledFor: draft.scheduled_for,
              source: 'ai_assistant',
              sourceLabel: 'AI Assistant',
              stage: 'approved',
              quality,
              needsReview: !!draft.needsReview,
              platformVariants: draft.platformVariants,
              status: 'scheduled',
              metadata: assistantMetadata,
            })
          : await createPost({
              title: deriveTitle(draft.content),
              content: draft.content,
              platforms: draft.platforms,
              scheduled_for: draft.scheduled_for,
              media_urls: draft.media_urls,
              status: 'scheduled',
              metadata: assistantMetadata,
            });
      } catch (persistError) {
        push({
          title: t('assistant.toast.saveFailed'),
          description: persistError instanceof Error ? persistError.message : draft.content.slice(0, 60),
          variant: 'error',
        });
      }
      if (!post) {
        push({ title: t('assistant.toast.saveFailed'), description: draft.content.slice(0, 60), variant: 'error' });
        continue;
      }

      // Phase 3, STEP 5 — Content <-> Performance. Best-effort, same
      // non-blocking contract as recordAIDecision above: a failure here
      // never blocks scheduling, it just leaves this post out of Pattern
      // Detection later.
      if (plan) {
        contentCharacteristicsRepository
          .create(
            buildContentCharacteristics({
              postId: post.id,
              workspaceId: workspace.id,
              content: draft.content,
              platforms: draft.platforms,
              plan,
              requestText,
              strategy: strategyRef.current,
              hook: hookRef.current,
              workspaceContext: workspaceContextRef.current,
              publishingTime: draft.scheduled_for,
            }),
          )
          .catch(() => {});
      }
      // Saving here already puts the post on the Calendar, the Publishing
      // Queue and the Posts list — they all read the same `posts` row live,
      // so there is nothing extra to "add" it to.
      results.push({ postId: post.id, title: post.title ?? deriveTitle(draft.content), status: post.status, error_message: null, verified: false });

      // Only posts that are ALREADY due (scheduled_for within the next
      // minute) get published immediately, using the same edge function
      // Manual "Publish Now" uses on the Posts page. A campaign scheduled
      // "بعد 5 دقائق" / "in 5 minutes" is 5 minutes out here, well past this
      // window, so it always waits for the existing run-scheduler cron —
      // it is never treated as Publish Now.
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

  return {
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
    drafts,
    monitored,
    campaignJobId,
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
  };
}
