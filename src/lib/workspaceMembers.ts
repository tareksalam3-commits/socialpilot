import { supabase } from './supabase';

export type WorkspaceMemberRow = {
  id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at: string;
  email: string | null;
};

async function callMembers<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/workspace-members`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    // ignore parse errors, handled below
  }
  if (!res.ok) {
    throw new Error((body?.error as string) ?? `فشل الطلب (${res.status})`);
  }
  return body as T;
}

export const workspaceMembers = {
  list: (workspaceId: string) => callMembers<{ members: WorkspaceMemberRow[] }>('list', { workspaceId }),
  invite: (workspaceId: string, email: string) =>
    callMembers<{ ok: true; email: string }>('invite', { workspaceId, email }),
  remove: (workspaceId: string, memberId: string) =>
    callMembers<{ ok: true }>('remove', { workspaceId, memberId }),
};
