import { supabase } from '@/services/supabase';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/trend-search`;

export type TrendSearchItem = { title: string; url: string; snippet: string; published_date: string | null };
export type TrendSearchResponse = { trend_available: boolean; items: TrendSearchItem[]; reason: string };

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error('لازم تسجّل الدخول أولًا — لا توجد جلسة نشطة (No active Supabase session).');
  }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` };
}

export const trendSearch = {
  async search(workspaceId: string, query: string): Promise<TrendSearchResponse> {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ workspace_id: workspaceId, query }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
    return await res.json();
  },
};
