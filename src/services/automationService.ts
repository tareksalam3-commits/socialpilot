import { supabase } from '@/services/supabase';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/automation-control`;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Automation request failed' }));
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }
  return await res.json();
}

export const automationService = {
  async retryTarget(workspaceId: string, targetId: string): Promise<{ success: boolean; target_id: string }> {
    return call({ action: 'retry_target', workspace_id: workspaceId, target_id: targetId });
  },

  async retryAllFailed(workspaceId: string): Promise<{ retried: number; succeeded: number; still_failed: number }> {
    return call({ action: 'retry_all_failed', workspace_id: workspaceId });
  },

  async runNow(workspaceId: string): Promise<{ published: number; retried: number; failed: number; checked_at: string }> {
    return call({ action: 'run_now', workspace_id: workspaceId });
  },
};
