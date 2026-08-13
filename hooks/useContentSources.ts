import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useBrandVoice } from '@/hooks/useBrandVoice';
import { useAISettings } from '@/hooks/useAISettings';
import { contentSourceRepository } from '@/repositories/contentSourceRepository';
import { contentExtraction } from '@/services/contentExtraction';
import { aiGateway } from '@/services/aiGateway';
import { postRepository } from '@/repositories/postRepository';
import { persistGeneratedContent, updateGeneratedContent } from '@/services/contentPersistence';
import { runQualityControlLoop, buildArabicWritingRules, runRewriteAgent } from '@/engines/aiOrchestrator';
import { resolveWorkspaceDialect } from '@/constants/dialects';
import type { ContentSource, ContentSourceType, ContentFetchError, GeneratedPostDraft, ProposedContentItem } from '@/types/contentSources';
import type { ContentQualityResult } from '@/types/assistant';

// Raw shape the AI returns from the batch "generate posts" call, before any
// Quality Control has run against it.
type RawPostCandidate = { content: string; platforms: string[]; scheduled_for: string };

function blankDraft(raw: RawPostCandidate, postId?: string): GeneratedPostDraft {
  return {
    post_id: postId,
    content: raw.content,
    platforms: raw.platforms,
    scheduled_for: raw.scheduled_for,
    quality: null,
    approved: false,
    needsReview: false,
    quality_error: false,
    checking: true,
  };
}

export function useContentSources() {
  const { workspace } = useWorkspace();
  const { brandVoice } = useBrandVoice();
  const { settings: aiSettings } = useAISettings();

  const [sources, setSources] = useState<ContentSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fetching, setFetching] = useState(false);
  const [proposedItems, setProposedItems] = useState<ProposedContentItem[]>([]);
  const [fetchErrors, setFetchErrors] = useState<ContentFetchError[]>([]);
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set());

  const [generating, setGenerating] = useState(false);
  const [generatedDrafts, setGeneratedDrafts] = useState<GeneratedPostDraft[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const [scheduling, setScheduling] = useState(false);

  const load = useCallback(async () => {
    if (!workspace) {
      // No workspace yet (e.g. still being created) — don't leave the UI stuck spinning.
      setSources([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setSources(await contentSourceRepository.list(workspace.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'فشل تحميل المصادر');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  const addLinkSource = useCallback(
    async (type: Exclude<ContentSourceType, 'pdf' | 'word' | 'excel'>, url: string, name?: string) => {
      if (!workspace) return;
      try {
        const created = await contentSourceRepository.createLink({ workspace_id: workspace.id, type, source_url: url, name });
        setSources((prev) => [created, ...prev]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'تعذّرت إضافة المصدر');
        throw e;
      }
    },
    [workspace],
  );

  const addFileSource = useCallback(
    async (type: 'pdf' | 'word' | 'excel', file: File) => {
      if (!workspace) return;
      try {
        const created = await contentSourceRepository.createFile({ workspace_id: workspace.id, type, file });
        setSources((prev) => [created, ...prev]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'تعذّر رفع الملف');
        throw e;
      }
    },
    [workspace],
  );

  const removeSource = useCallback(async (source: ContentSource) => {
    try {
      await contentSourceRepository.remove(source);
      setSources((prev) => prev.filter((s) => s.id !== source.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذّر حذف المصدر');
    }
  }, []);

  // "جلب المحتوى الجديد" — runs the extraction edge function across all (or
  // selected) sources and stages the results for the user to review/select.
  const fetchNewContent = useCallback(
    async (sourceIds?: string[]) => {
      if (!workspace) return;
      setFetching(true);
      setError(null);
      setGeneratedDrafts([]);
      try {
        const { items, errors } = await contentExtraction.fetchNewContent(workspace.id, sourceIds);
        setProposedItems(items);
        setFetchErrors(errors);
        setSelectedHashes(new Set());
        await load(); // refresh last_fetched_at / status per source
      } catch (e) {
        setError(e instanceof Error ? e.message : 'فشل جلب المحتوى الجديد');
      } finally {
        setFetching(false);
      }
    },
    [workspace, load],
  );

  const toggleSelected = useCallback((hash: string) => {
    setSelectedHashes((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) next.delete(hash);
      else next.add(hash);
      return next;
    });
  }, []);

  const selectedItems = proposedItems.filter((item) => selectedHashes.has(item.content_hash));

  // Runs the exact same Sanitize → Arabic Naturalness Guard → AI Quality
  // Control → evaluateContentApproval pipeline the AI Assistant uses
  // (runQualityControlLoop in assistantOrchestrator) against one already-
  // generated draft. Attempt 0 re-checks the content the batch call already
  // produced; every attempt after that asks the AI to rewrite just this one
  // post, specifically addressing the previous attempt's issues, until it
  // clears the quality bar or runs out of attempts — never scheduled
  // automatically unless it's genuinely approved.
  const runDraftQualityControl = useCallback(
    async (raw: RawPostCandidate, userPrompt: string): Promise<GeneratedPostDraft> => {
      if (!workspace) return { ...blankDraft(raw), checking: false, needsReview: true };

      // Quality Control Model Separation: the loop's own QC calls always
      // prefer the dedicated qc_model, never default_model — see
      // qualityControl.ts / taskRouter.ts for the full guarantee (each
      // candidate below also names the exact model that authored it, so
      // runQualityControlLoop can exclude it per-attempt too).
      const aiParams = { model: aiSettings?.qc_model ?? undefined, maxTokens: aiSettings?.max_tokens };
      const dialect = resolveWorkspaceDialect(workspace);

      const getCandidate = async (
        attempt: number,
        previous: { content: string; quality: ContentQualityResult | null; reasons: string[] } | null,
      ): Promise<{ content: string; model: string | null }> => {
        // Attempt 0 is the content the earlier batch "generate posts" call
        // already produced — that call didn't track a per-post model, so
        // there's no authoring model to exclude here; the QC model
        // preference above still keeps it independent in practice.
        if (attempt === 0) return { content: raw.content, model: null };

        // Phase 2, STEP 12 (Smart Rewrite, section 22) — same targeted
        // Rewrite Task the AI Assistant pipeline uses (Original Content +
        // Quality Report + Failed Dimensions + Brand DNA + Platform Rules),
        // replacing this hook's own ad-hoc rewrite prompt so every
        // authoring surface in the app shares one Rewrite Task, per this
        // module's own "same pipeline end to end" contract (see
        // contentGuards.ts header). No WorkspaceContext is built in this
        // flow yet, so Audience Intelligence is simply omitted — Brand DNA
        // still comes through via runRewriteAgent's own brandVoiceRepository
        // fetch, same as `brandVoice` was passed here before.
        const base = previous?.content || raw.content;
        try {
          const { content, model } = await runRewriteAgent(
            workspace.id,
            base,
            previous?.quality ?? null,
            previous?.reasons ?? [],
            raw.platforms,
            { model: aiSettings?.default_model, maxTokens: aiSettings?.max_tokens },
            null,
            dialect,
          );
          return { content, model };
        } catch {
          return { content: '', model: null }; // getCandidate failing just skips this attempt, per the loop's contract
        }
      };

      const result = await runQualityControlLoop(workspace.id, raw.platforms, userPrompt, aiParams, getCandidate, dialect);
      return {
        content: result.content || raw.content,
        platforms: raw.platforms,
        scheduled_for: raw.scheduled_for,
        quality: result.quality,
        approved: result.approved,
        needsReview: result.needsReview,
        quality_error: result.quality_error,
        checking: false,
      };
    },
    [workspace, aiSettings],
  );

  // Sends the user's selected content + instruction to the AI Gateway,
  // asking for a structured array of posts back as JSON, then runs every
  // post through Quality Control (see runDraftQualityControl) before it is
  // ever eligible for scheduling — same bar the AI Assistant enforces, so
  // no authoring surface in the app can produce a scheduled post that
  // skipped review.
  const generatePosts = useCallback(
    async (userPrompt: string, platforms: string[]) => {
      if (!workspace || selectedItems.length === 0) return;
      setGenerating(true);
      setGenerationError(null);
      setGeneratedDrafts([]);
      const dialect = resolveWorkspaceDialect(workspace);
      try {
        const combinedContent = selectedItems
          .map((item) => `### ${item.title}${item.url ? ` (${item.url})` : ''}\n${item.summary}`)
          .join('\n\n');

        const instruction =
          `${userPrompt}\n\n` +
          `The source material above (from Content Sources: RSS/Web/YouTube/PDF/Word/Excel) is grounding ` +
          `context only — understand and summarize its ideas, never copy or translate it verbatim into a post. ` +
          `Every post's "content" field must independently follow the Egyptian Arabic writing rules given in ` +
          `the system message whenever the output is Arabic.\n\n` +
          `Respond ONLY with minified JSON — an array of post objects, no markdown, in exactly this shape: ` +
          `[{"content": "string", "platforms": ["linkedin"|"twitter"|"facebook"|"instagram", ...], "scheduled_for": "ISO 8601 datetime"}]. ` +
          `Spread the scheduled_for timestamps sensibly across the coming week starting from tomorrow. ` +
          `Only use these platforms unless the instruction says otherwise: ${platforms.join(', ') || 'linkedin, twitter'}.`;

        // "Rewrite in Professional Egyptian Arabic" stage: the same rules the
        // Creator agent applies for the AI Assistant are applied here too, so
        // extracted/summarized source content is never turned into a post in
        // plain/Fus-ha Arabic before it ever reaches Quality Control below.
        const result = await aiGateway.generate({
          workspaceId: workspace.id,
          messages: [
            { role: 'system', content: buildArabicWritingRules(dialect) },
            { role: 'user', content: instruction },
          ],
          stream: false,
          contentText: combinedContent,
          brandVoice: brandVoice as unknown as Record<string, unknown> | null,
          task: 'creator',
        });

        const cleaned = result.content.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
        const parsed = JSON.parse(cleaned) as RawPostCandidate[];
        if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('لم يُرجع الذكاء الاصطناعي قائمة منشورات صالحة');

        // Persist every output before quality review so leaving this page can
        // never discard generated content. The existing posts row remains the
        // sole source of truth; local state is only the current review view.
        const stagedDrafts = await Promise.all(
          parsed.map(async (raw) => {
            try {
              const post = await persistGeneratedContent({
                workspaceId: workspace.id,
                content: raw.content,
                platforms: raw.platforms,
                scheduledFor: raw.scheduled_for,
                source: 'content_sources',
                sourceLabel: 'Content Sources',
                stage: 'generated',
                metadata: {
                  content_sources: {
                    source_hashes: selectedItems.map((item) => item.content_hash),
                    source_ids: Array.from(new Set(selectedItems.map((item) => item.source_id))),
                    generation_prompt: userPrompt,
                  },
                },
              });
              return blankDraft(raw, post.id);
            } catch (persistError) {
              setGenerationError(persistError instanceof Error ? persistError.message : 'تعذّر حفظ المحتوى المُولّد');
              return blankDraft(raw);
            }
          }),
        );
        setGeneratedDrafts(stagedDrafts);

        // Stage every draft immediately in a "checking" state so the user
        // sees progress, then update the persisted record in place as Quality
        // Control finishes (sequential — one AI Gateway conversation at a
        // time per draft, same as the AI Assistant's own pipeline).
        for (let i = 0; i < parsed.length; i++) {
          const reviewed = await runDraftQualityControl(parsed[i], userPrompt);
          const staged = stagedDrafts[i];
          if (staged?.post_id) {
            try {
              await updateGeneratedContent(staged.post_id, {
                content: reviewed.content,
                platforms: reviewed.platforms,
                source: 'content_sources',
                sourceLabel: 'Content Sources',
                stage: reviewed.approved ? 'approved' : 'in_review',
                quality: reviewed.quality,
                needsReview: reviewed.needsReview || reviewed.quality_error,
              });
            } catch (persistError) {
              setGenerationError(persistError instanceof Error ? persistError.message : 'تعذّر تحديث مراجعة المحتوى');
            }
          }
          setGeneratedDrafts((prev) =>
            prev.map((d, idx) => (idx === i ? { ...reviewed, post_id: d.post_id } : d)),
          );
        }
      } catch (e) {
        setGenerationError(e instanceof Error ? e.message : 'فشل توليد المنشورات');
      } finally {
        setGenerating(false);
      }
    },
    [workspace, selectedItems, brandVoice, runDraftQualityControl],
  );

  // Re-runs Quality Control for a single staged draft — used when the user
  // wants another pass at a post marked "Needs Manual Review" without
  // regenerating the whole batch.
  const regenerateDraft = useCallback(
    async (index: number) => {
      const draft = generatedDrafts[index];
      if (!draft || !workspace) return;
      setGeneratedDrafts((prev) => prev.map((d, idx) => (idx === index ? { ...d, checking: true } : d)));
      const reviewed = await runDraftQualityControl(
        { content: draft.content, platforms: draft.platforms, scheduled_for: draft.scheduled_for },
        '',
      );
      if (draft.post_id) {
        try {
          await updateGeneratedContent(draft.post_id, {
            content: reviewed.content,
            platforms: reviewed.platforms,
            source: 'content_sources',
            sourceLabel: 'Content Sources',
            stage: reviewed.approved ? 'approved' : 'in_review',
            quality: reviewed.quality,
            needsReview: reviewed.needsReview || reviewed.quality_error,
          });
        } catch (persistError) {
          setGenerationError(persistError instanceof Error ? persistError.message : 'تعذّر تحديث مراجعة المحتوى');
        }
      }
      setGeneratedDrafts((prev) => prev.map((d, idx) => (idx === index ? { ...reviewed, post_id: d.post_id } : d)));
    },
    [generatedDrafts, workspace, runDraftQualityControl],
  );

  // Drops a staged draft the user doesn't want to keep (e.g. one that keeps
  // failing Quality Control) without touching the rest of the batch.
  const removeDraft = useCallback(async (index: number) => {
    const draft = generatedDrafts[index];
    if (draft?.post_id) {
      await postRepository.update(draft.post_id, { status: 'archived' });
    }
    setGeneratedDrafts((prev) => prev.filter((_, idx) => idx !== index));
  }, [generatedDrafts]);

  // Inserts every APPROVED staged draft as a scheduled post, then marks
  // each source whose content was used so it isn't re-suggested next
  // fetch. Drafts still needing manual review are deliberately left out of
  // the insert and kept on screen — Content Sources never auto-schedules
  // anything that hasn't cleared the same Quality Control bar the AI
  // Assistant enforces.
  const confirmSchedule = useCallback(async () => {
    if (!workspace) return;
    const approvedDrafts = generatedDrafts.filter((d) => d.approved && !d.checking);
    if (approvedDrafts.length === 0) return;
    setScheduling(true);
    try {
      await Promise.all(
        approvedDrafts.map((draft) =>
          draft.post_id
            ? updateGeneratedContent(draft.post_id, {
                content: draft.content,
                platforms: draft.platforms,
                source: 'content_sources',
                sourceLabel: 'Content Sources',
                stage: 'approved',
                quality: draft.quality,
                needsReview: false,
                status: 'scheduled',
                scheduledFor: draft.scheduled_for,
              })
            : postRepository.create({
                workspace_id: workspace.id,
                content: draft.content,
                platforms: draft.platforms,
                status: 'scheduled',
                scheduled_for: draft.scheduled_for,
              }),
        ),
      );

      const usedSourceIds = new Set(selectedItems.map((item) => item.source_id));
      await Promise.all(
        Array.from(usedSourceIds).map((sourceId) => {
          const item = selectedItems.find((i) => i.source_id === sourceId)!;
          return contentExtraction.markProcessed(workspace.id, sourceId, item.content_hash).then(() =>
            contentSourceRepository.updateLastProcessedHash(sourceId, item.content_hash),
          );
        }),
      );

      setProposedItems((prev) => prev.filter((item) => !usedSourceIds.has(item.source_id)));
      setSelectedHashes(new Set());
      // Only the drafts that were actually scheduled are cleared — anything
      // still needing manual review stays staged for the user to fix.
      setGeneratedDrafts((prev) => prev.filter((d) => !(d.approved && !d.checking)));
      await load();
    } catch (e) {
      setGenerationError(e instanceof Error ? e.message : 'فشل جدولة المنشورات');
      throw e;
    } finally {
      setScheduling(false);
    }
  }, [workspace, generatedDrafts, selectedItems, load]);

  return {
    sources,
    loading,
    error,
    addLinkSource,
    addFileSource,
    removeSource,
    fetching,
    proposedItems,
    fetchErrors,
    fetchNewContent,
    selectedHashes,
    selectedItems,
    toggleSelected,
    generating,
    generatedDrafts,
    generationError,
    generatePosts,
    regenerateDraft,
    removeDraft,
    scheduling,
    confirmSchedule,
    reload: load,
  };
}
