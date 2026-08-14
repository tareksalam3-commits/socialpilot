import { supabase } from '@/services/supabase';
import type { ContentFetchError, ProposedContentItem } from '@/types/contentSources';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/content-extraction`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error('لازم تسجّل الدخول أولًا — لا توجد جلسة نشطة (No active Supabase session).');
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` };
}

export const contentExtraction = {
  // Triggers the "جلب المحتوى الجديد" flow: fetches new content since each
  // source's last_fetched_at, skips anything matching last_processed_hash,
  // filters by brand voice, and returns ready-to-review summaries.
  async fetchNewContent(workspaceId: string, sourceIds?: string[]): Promise<{ items: ProposedContentItem[]; errors: ContentFetchError[] }> {
    const res = await fetch(`${FUNCTION_URL}?action=fetch`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ workspace_id: workspaceId, source_ids: sourceIds }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
    return await res.json();
  },

  async markProcessed(workspaceId: string, sourceId: string, contentHash: string): Promise<void> {
    const res = await fetch(`${FUNCTION_URL}?action=mark-processed`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ workspace_id: workspaceId, source_id: sourceId, content_hash: contentHash }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
  },
};
