import type { ChatMessage, ChatCompletionResult, ModelInfo, ProviderInfo } from '@/types/ai';
import { supabase } from '@/services/supabase';

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-gateway`;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error('لازم تسجّل الدخول أولًا — لا توجد جلسة نشطة (No active Supabase session).');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.session.access_token}`,
  };
}

export type GenerateOptions = {
  workspaceId: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  freeOnly?: boolean;
  brandVoice?: Record<string, unknown> | null;
  onChunk?: (chunk: string) => void;
};

export const aiGateway = {
  async generate(opts: GenerateOptions): Promise<ChatCompletionResult> {
    const res = await fetch(`${FUNCTION_URL}?action=chat`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        workspace_id: opts.workspaceId,
        messages: opts.messages,
        model: opts.model,
        temperature: opts.temperature,
        max_tokens: opts.maxTokens,
        stream: opts.stream,
        free_only: opts.freeOnly,
        brand_voice: opts.brandVoice,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }

    const contentType = res.headers.get('Content-Type') ?? '';

    if (contentType.includes('text/event-stream') && opts.onChunk) {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;
        opts.onChunk(chunk);
      }
      return {
        content: fullContent,
        model: res.headers.get('X-Model') ?? '',
        tokens_in: 0,
        tokens_out: 0,
        response_time_ms: parseInt(res.headers.get('X-Response-Time') ?? '0', 10),
      };
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return {
      content: data.content,
      model: data.model,
      tokens_in: data.tokens_in,
      tokens_out: data.tokens_out,
      response_time_ms: data.response_time_ms,
    };
  },

  async listModels(workspaceId: string, provider?: string): Promise<{ models: ModelInfo[]; free_count: number; total_count: number }> {
    const res = await fetch(`${FUNCTION_URL}?action=models`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ workspace_id: workspaceId, provider }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to list models' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
    return await res.json();
  },

  async testConnection(workspaceId: string, provider?: string): Promise<{ status: string; data?: unknown }> {
    const res = await fetch(`${FUNCTION_URL}?action=test`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ workspace_id: workspaceId, provider }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Connection test failed' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
    return await res.json();
  },

  async getProviders(): Promise<ProviderInfo[]> {
    const res = await fetch(`${FUNCTION_URL}?action=providers`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to load providers' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
    const data = await res.json();
    return (data.providers ?? []) as ProviderInfo[];
  },
};
