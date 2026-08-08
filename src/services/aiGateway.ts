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
  // Source content selected from Content Sources (article/document/transcript
  // excerpt) to ground this generation in — forwarded to the gateway as
  // `content_text`.
  contentText?: string | null;
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
        content_text: opts.contentText,
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
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // last line may be split across chunks — keep it for next read

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]' || payload === '') continue;

          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta;
            // reasoning tokens (model "thinking") are intentionally skipped —
            // only the actual generated text goes to the caller
            if (delta?.content) {
              fullContent += delta.content;
              opts.onChunk(delta.content);
            }
          } catch {
            // JSON split across a chunk boundary — will complete on a later read
          }
        }
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

  // Generates one image and returns its public URL — the edge function
  // already saved it into the workspace's `media` Storage bucket, so the
  // only thing left for the caller to do is register it as a MediaItem
  // (mediaRepository.create) if it should show up in the Media Library.
  async generateImage(opts: { workspaceId: string; prompt: string; width?: number; height?: number }): Promise<{ url: string; width: number; height: number }> {
    const res = await fetch(`${FUNCTION_URL}?action=image`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        workspace_id: opts.workspaceId,
        prompt: opts.prompt,
        width: opts.width,
        height: opts.height,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Image generation failed' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
    return await res.json();
  },

  // Provider/model management is platform-wide (Super Admin only) — no
  // workspace_id here, the edge function checks is_super_admin() instead.
  async listModels(provider?: string): Promise<{ models: ModelInfo[]; free_count: number; total_count: number }> {
    const res = await fetch(`${FUNCTION_URL}?action=models`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ provider }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to list models' }));
      throw new Error(err.error ?? `Request failed (${res.status})`);
    }
    return await res.json();
  },

  async testConnection(provider?: string): Promise<{ status: string; data?: unknown }> {
    const res = await fetch(`${FUNCTION_URL}?action=test`, {
      method: 'POST',
      headers: await getAuthHeaders(),
      body: JSON.stringify({ provider }),
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
