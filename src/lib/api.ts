import { supabase } from './supabase';
import type { AiGatewayRequest, AiGatewayResponse } from './types';

export async function startSocialOAuth(workspaceId: string, platformKey: 'meta' | 'linkedin' = 'meta'): Promise<string> {
  const { data: session } = await supabase.auth.getSession();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/social-oauth-start`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({ workspaceId, platformKey }),
  });

  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch {
    // ignore parse errors, handled below
  }

  if (!res.ok || !body.url) {
    throw new Error((body?.error as string) ?? `تعذّر بدء الربط (${res.status})`);
  }
  return body.url as string;
}

export async function callAiGateway(req: AiGatewayRequest): Promise<AiGatewayResponse> {
  const { data: session } = await supabase.auth.getSession();
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-gateway`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.session?.access_token ?? ''}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) detail = body.error;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  const data = (await res.json()) as AiGatewayResponse;
  if (!data || !data.result) {
    throw new Error('Received an unexpected response from the AI service.');
  }
  return data;
}
