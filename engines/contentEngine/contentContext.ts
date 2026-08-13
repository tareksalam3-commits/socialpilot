import { contentSourceRepository } from '@/repositories/contentSourceRepository';
import { contentExtraction } from '@/services/contentExtraction';
import type { UsedContentSource } from '@/types/assistant';

/** Runs the "collect information from Content Sources" step of the pipeline.
 * Reuses the existing Content Sources module end-to-end — the same
 * content-extraction Edge Function the Content Sources page calls already
 * fetches, cleans, and summarizes each source, so this just gathers those
 * summaries into one block of grounding text for the Creator agent (passed
 * on as `contentText`, the same field the Content Studio's "ground in
 * source" feature already uses). Never throws — a source hiccup should
 * degrade to "no extra context" rather than break the whole campaign. */
export async function collectContentContext(
  workspaceId: string,
): Promise<{ contentText: string | null; used: UsedContentSource[]; error: string | null }> {
  try {
    const sources = await contentSourceRepository.list(workspaceId);
    if (sources.length === 0) {
      return { contentText: null, used: [], error: 'no_sources' };
    }
    const { items } = await contentExtraction.fetchNewContent(workspaceId);
    const relevant = items.filter((i) => i.relevant).slice(0, 8);
    if (relevant.length === 0) {
      return { contentText: null, used: [], error: 'no_new_items' };
    }
    const contentText = relevant
      .map((i) => `- ${i.title}${i.source_name ? ` (${i.source_name})` : ''}: ${i.summary}`)
      .join('\n');
    const used: UsedContentSource[] = relevant.map((i) => ({ source_id: i.source_id, source_name: i.source_name, title: i.title }));
    return { contentText, used, error: null };
  } catch (e) {
    return { contentText: null, used: [], error: e instanceof Error ? e.message : 'content_sources_failed' };
  }
}
