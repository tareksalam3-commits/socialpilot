import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useBrandVoice } from '@/hooks/useBrandVoice';
import { contentSourceRepository } from '@/repositories/contentSourceRepository';
import { contentExtraction } from '@/services/contentExtraction';
import { aiGateway } from '@/services/aiGateway';
import { postRepository } from '@/repositories/postRepository';
import type { ContentSource, ContentSourceType, ContentFetchError, GeneratedPostDraft, ProposedContentItem } from '@/types/contentSources';

export function useContentSources() {
  const { workspace } = useWorkspace();
  const { brandVoice } = useBrandVoice();

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

  // Sends the user's selected content + instruction to the AI Gateway,
  // asking for a structured array of posts back as JSON.
  const generatePosts = useCallback(
    async (userPrompt: string, platforms: string[]) => {
      if (!workspace || selectedItems.length === 0) return;
      setGenerating(true);
      setGenerationError(null);
      try {
        const combinedContent = selectedItems
          .map((item) => `### ${item.title}${item.url ? ` (${item.url})` : ''}\n${item.summary}`)
          .join('\n\n');

        const instruction =
          `${userPrompt}\n\n` +
          `Respond ONLY with minified JSON — an array of post objects, no markdown, in exactly this shape: ` +
          `[{"content": "string", "platforms": ["linkedin"|"twitter"|"facebook"|"instagram", ...], "scheduled_for": "ISO 8601 datetime"}]. ` +
          `Spread the scheduled_for timestamps sensibly across the coming week starting from tomorrow. ` +
          `Only use these platforms unless the instruction says otherwise: ${platforms.join(', ') || 'linkedin, twitter'}.`;

        const result = await aiGateway.generate({
          workspaceId: workspace.id,
          messages: [{ role: 'user', content: instruction }],
          stream: false,
          contentText: combinedContent,
          brandVoice: brandVoice as unknown as Record<string, unknown> | null,
        });

        const cleaned = result.content.trim().replace(/^```json\s*/i, '').replace(/```$/, '');
        const parsed = JSON.parse(cleaned) as GeneratedPostDraft[];
        if (!Array.isArray(parsed)) throw new Error('لم يُرجع الذكاء الاصطناعي قائمة منشورات صالحة');
        setGeneratedDrafts(parsed);
      } catch (e) {
        setGenerationError(e instanceof Error ? e.message : 'فشل توليد المنشورات');
      } finally {
        setGenerating(false);
      }
    },
    [workspace, selectedItems, brandVoice],
  );

  // Inserts every staged draft as a scheduled post, then marks each source
  // whose content was used so it isn't re-suggested next fetch.
  const confirmSchedule = useCallback(async () => {
    if (!workspace || generatedDrafts.length === 0) return;
    setScheduling(true);
    try {
      await Promise.all(
        generatedDrafts.map((draft) =>
          postRepository.create({
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
      setGeneratedDrafts([]);
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
    scheduling,
    confirmSchedule,
    reload: load,
  };
}
