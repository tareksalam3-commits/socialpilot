import { supabase } from '@/services/supabase';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/publish-post`;

export const publishingService = {
  async publishNow(postId: string, workspaceId: string): Promise<{ status: string; post_id: string }> {
    const { data: session } = await supabase.auth.getSession();
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ post_id: postId, workspace_id: workspaceId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Publishing failed' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
    return await res.json();
  },
};
