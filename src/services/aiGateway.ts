import type { ChatMessage, ChatCompletionResult, ModelInfo, ProviderInfo } from '@/types/ai';
import { supabase } from '@/services/supabase';
import { AI_CALL_TIMEOUT_MS, measurePerformance } from '@/utils/performanceTelemetry';

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
  // Quality Control Model Separation (see taskRouter.ts): mark a request as
  // the independent QC review of a draft so the Gateway resolves
  // ai_settings.qc_model instead of default_model, and/or pass the model
  // that authored the draft so the Gateway guarantees it never re-uses it.
  task?: 'creator' | 'qc' | 'other';
  excludeModel?: string;
  onChunk?: (chunk: string) => void;
};

// Reasoning-tuned models (DeepSeek-R1 style — common among the free/router
// models this app auto-picks) don't put their "thinking" in a separate
// delta field the way delta?.content vs delta?.reasoning skipping above
// assumes — they write it as plain text inside delta.content itself,
// wrapped in <think>...</think> (or <thinking>...</thinking>). Since chunks
// are forwarded straight to onChunk() for a live typewriter effect, that
// thinking text was rendering directly into the post body as it streamed
// in. This buffers across chunk boundaries so a tag split between two
// network reads is still caught, and only ever emits text that's actually
// outside a think block.
const THINK_OPEN_RE = /<think(?:ing)?>/i;
const THINK_CLOSE_RE = /<\/think(?:ing)?>/i;
const THINK_OPEN_TAG = '<think'; // shortest literal prefix shared by both variants

class ReasoningStreamFilter {
  private buffer = '';
  private inThink = false;

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';

    // Bound how many iterations we spin through per push — each branch below
    // either emits/discards a fixed span or breaks waiting on more data, so
    // this only guards against an unforeseen infinite loop.
    for (let guard = 0; guard < 1000; guard++) {
      if (!this.inThink) {
        const openMatch = THINK_OPEN_RE.exec(this.buffer);
        if (openMatch) {
          out += this.buffer.slice(0, openMatch.index);
          this.buffer = this.buffer.slice(openMatch.index + openMatch[0].length);
          this.inThink = true;
          continue;
        }
        // No full opening tag yet — but the buffer might end mid-tag (e.g.
        // this read stopped at "...<thi"). Hold back a possible partial
        // match so it can complete once the next chunk arrives instead of
        // being emitted as literal text.
        const lowerTail = this.buffer.slice(-THINK_OPEN_TAG.length).toLowerCase();
        let holdFrom = this.buffer.length;
        for (let i = 1; i <= Math.min(THINK_OPEN_TAG.length, this.buffer.length); i++) {
          if (THINK_OPEN_TAG.toLowerCase().startsWith(lowerTail.slice(lowerTail.length - i))) {
            holdFrom = this.buffer.length - i;
            break;
          }
        }
        out += this.buffer.slice(0, holdFrom);
        this.buffer = this.buffer.slice(holdFrom);
        break;
      } else {
        const closeMatch = THINK_CLOSE_RE.exec(this.buffer);
        if (closeMatch) {
          // Everything up to and including the closing tag was reasoning —
          // drop it, never forward it to the caller.
          this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length);
          this.inThink = false;
          continue;
        }
        // Still inside a think block with no closing tag in sight yet —
        // nothing to emit; keep buffering (bounded by the block's own size).
        break;
      }
    }

    return out;
  }

  // Called once the stream ends. A properly closed think block has already
  // been dropped by push(); if we're still "inThink" here the model simply
  // never closed the tag, so the remainder is reasoning too — drop it
  // rather than leak an unterminated thinking dump as the tail of the post.
  flush(): string {
    if (this.inThink) {
      this.buffer = '';
      return '';
    }
    const rest = this.buffer;
    this.buffer = '';
    return rest;
  }
}

export const aiGateway = {
  async generate(opts: GenerateOptions): Promise<ChatCompletionResult> {
    return measurePerformance('ai_call', opts.task === 'qc' ? 'quality_control' : opts.task === 'creator' ? 'authoring' : 'ai_generation', async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), AI_CALL_TIMEOUT_MS);
      try {
        const res = await fetch(`${FUNCTION_URL}?action=chat`, {
          method: 'POST',
          headers: await getAuthHeaders(),
          signal: controller.signal,
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
            task: opts.task,
            exclude_model: opts.excludeModel,
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
          const reasoningFilter = new ReasoningStreamFilter();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (payload === '[DONE]' || payload === '') continue;
              try {
                const json = JSON.parse(payload);
                const delta = json.choices?.[0]?.delta;
                if (delta?.content) {
                  const visible = reasoningFilter.push(delta.content);
                  if (visible) {
                    fullContent += visible;
                    opts.onChunk(visible);
                  }
                }
              } catch {
                // JSON split across a chunk boundary; continue buffering.
              }
            }
          }
          const tail = reasoningFilter.flush();
          if (tail) {
            fullContent += tail;
            opts.onChunk(tail);
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
      } finally {
        window.clearTimeout(timeout);
      }
    });
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
