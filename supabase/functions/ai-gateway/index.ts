import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };
type ChatRequestBody = {
  workspace_id: string;
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  free_only?: boolean;
  brand_voice?: Record<string, unknown> | null;
};

type ModelInfo = {
  id: string;
  name: string;
  pricing?: { prompt: string; completion: string };
  context_length?: number;
  architecture?: { modality?: string };
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

async function isWorkspaceMember(supabase: ReturnType<typeof createClient>, workspaceId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

async function getApiKey(supabase: ReturnType<typeof createClient>, workspaceId: string, callerId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_ai_provider_key', { p_workspace_id: workspaceId, p_caller_id: callerId });
  if (error || !data) return null;
  return data as string;
}

async function getAiSettings(supabase: ReturnType<typeof createClient>, workspaceId: string) {
  const { data, error } = await supabase
    .from('ai_settings')
    .select('default_model, temperature, max_tokens, streaming, free_only_mode, mode, last_successful_model')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}


async function fetchModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetchWithTimeout(`${OPENROUTER_BASE}/models`, { headers: { Authorization: `Bearer ${apiKey}` } }, 15_000);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const json = await res.json();
  return json.data as ModelInfo[];
}

function pickFreeModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => {
    const prompt = parseFloat(m.pricing?.prompt ?? '1');
    const completion = parseFloat(m.pricing?.completion ?? '1');
    return prompt === 0 && completion === 0;
  });
}

async function recordUsage(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  event: {
    model: string;
    provider: string;
    tokens_in: number;
    tokens_out: number;
    cost: number;
    status: string;
    response_time_ms: number;
    prompt_type: string;
  },
): Promise<void> {
  await supabase.from('ai_usage_events').insert({
    workspace_id: workspaceId,
    user_id: userId,
    model: event.model,
    provider: event.provider,
    tokens_in: event.tokens_in,
    tokens_out: event.tokens_out,
    cost: event.cost,
    status: event.status,
    response_time_ms: event.response_time_ms,
    prompt_type: event.prompt_type,
  });
}

async function updateLastSuccessfulModel(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  model: string,
): Promise<void> {
  await supabase.from('ai_settings').update({ last_successful_model: model, updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId);
}

async function handleChatCompletion(
  supabase: ReturnType<typeof createClient>,
  body: ChatRequestBody,
  apiKey: string,
  settings: Awaited<ReturnType<typeof getAiSettings>>,
  userId: string,
): Promise<Response> {
  const model = body.model || settings?.default_model || 'openrouter/auto';
  const temperature = body.temperature ?? settings?.temperature ?? 0.7;
  const maxTokens = body.max_tokens ?? settings?.max_tokens ?? 1024;
  const stream = body.stream ?? settings?.streaming ?? true;
  const freeOnly = body.free_only ?? settings?.free_only_mode ?? true;

  let messages = body.messages;
  if (body.brand_voice) {
    const bv = body.brand_voice as Record<string, string | string[]>;
    const systemContent = `You are an AI content assistant for a brand. Apply this brand voice in every response:
- Business: ${bv.business_name ?? 'N/A'}
- Description: ${bv.description ?? 'N/A'}
- Audience: ${bv.audience ?? 'N/A'}
- Industry: ${bv.industry ?? 'N/A'}
- Writing style: ${bv.writing_style ?? 'professional'}
- Tone: ${bv.tone ?? 'professional'}
- Keywords to include: ${Array.isArray(bv.keywords) ? bv.keywords.join(', ') : 'none'}
- Keywords to avoid: ${Array.isArray(bv.negative_keywords) ? bv.negative_keywords.join(', ') : 'none'}
- CTA style: ${bv.cta_style ?? 'clear'}
- Emoji style: ${bv.emoji_style ?? 'minimal'}`;
    messages = [{ role: 'system', content: systemContent }, ...messages];
  }

  const startTime = Date.now();

  let lastError: string | null = null;
  let modelsToTry: string[] = [model];

  if (freeOnly && model === 'openrouter/auto') {
    try {
      const allModels = await fetchModels(apiKey);
      const freeModels = pickFreeModels(allModels);
      if (settings?.last_successful_model && freeModels.some((m) => m.id === settings.last_successful_model)) {
        modelsToTry = [settings.last_successful_model, ...freeModels.map((m) => m.id).filter((id) => id !== settings.last_successful_model)];
      } else {
        modelsToTry = freeModels.map((m) => m.id);
      }
      if (modelsToTry.length === 0) modelsToTry = [model];
    } catch {
      // fall back to the requested model
    }
  }

  const payload = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream,
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const currentModel = attempt === 0 ? model : modelsToTry[attempt % modelsToTry.length] || model;
    try {
      const res = await fetchWithTimeout(
        `${OPENROUTER_BASE}/chat/completions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://socialpilot.ai',
            'X-Title': 'SocialPilot AI',
          },
          body: JSON.stringify({ ...payload, model: currentModel }),
        },
        REQUEST_TIMEOUT_MS,
      );

      if (!res.ok) {
        const errText = await res.text();
        lastError = `OpenRouter ${res.status}: ${errText}`;
        if (res.status === 429 || res.status >= 500) {
          await delay(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        break;
      }

      const responseTime = Date.now() - startTime;

      if (stream) {
        const stream = new ReadableStream({
          async start(controller) {
            const reader = res.body!.getReader();
            const decoder = new TextDecoder();
            let totalContent = '';
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const chunk = decoder.decode(value, { stream: true });
                totalContent += chunk;
                controller.enqueue(value);
              }
            } catch (e) {
              controller.error(e);
              return;
            }
            controller.close();
            const tokensOut = estimateTokens(totalContent);
            const tokensIn = estimateTokens(JSON.stringify(messages));
            await updateLastSuccessfulModel(supabase, body.workspace_id, currentModel);
            await recordUsage(supabase, body.workspace_id, userId, {
              model: currentModel,
              provider: 'openrouter',
              tokens_in: tokensIn,
              tokens_out: tokensOut,
              cost: 0,
              status: 'success',
              response_time_ms: responseTime,
              prompt_type: 'chat',
            });
          },
        });
        return new Response(stream, {
          headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'X-Model': currentModel, 'X-Response-Time': String(responseTime) },
        });
      } else {
        const json = await res.json();
        const content = json.choices?.[0]?.message?.content ?? '';
        const tokensIn = json.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages));
        const tokensOut = json.usage?.completion_tokens ?? estimateTokens(content);
        await updateLastSuccessfulModel(supabase, body.workspace_id, currentModel);
        await recordUsage(supabase, body.workspace_id, userId, {
          model: currentModel,
          provider: 'openrouter',
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          cost: 0,
          status: 'success',
          response_time_ms: responseTime,
          prompt_type: 'chat',
        });
        return jsonResponse({
          content,
          model: currentModel,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          response_time_ms: responseTime,
        });
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Unknown error';
      if (attempt < MAX_RETRIES - 1) {
        await delay(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }

  const responseTime = Date.now() - startTime;
  if (userId) {
    await recordUsage(supabase, body.workspace_id, userId, {
      model,
      provider: 'openrouter',
      tokens_in: 0,
      tokens_out: 0,
      cost: 0,
      status: 'failed',
      response_time_ms: responseTime,
      prompt_type: 'chat',
    });
  }
  return errorResponse(lastError ?? 'All retries exhausted', 502);
}

async function handleModels(apiKey: string): Promise<Response> {
  try {
    const models = await fetchModels(apiKey);
    const freeModels = pickFreeModels(models);
    return jsonResponse({
      models: models.map((m) => ({
        id: m.id,
        name: m.name,
        context_length: m.context_length,
        is_free: parseFloat(m.pricing?.prompt ?? '1') === 0 && parseFloat(m.pricing?.completion ?? '1') === 0,
        pricing: m.pricing,
      })),
      free_count: freeModels.length,
      total_count: models.length,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Failed to fetch models', 502);
  }
}

async function handleTestConnection(apiKey: string): Promise<Response> {
  try {
    const res = await fetchWithTimeout(
      `${OPENROUTER_BASE}/key`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
      10_000,
    );
    if (!res.ok) return errorResponse(`Connection failed: ${res.status}`, res.status);
    const json = await res.json();
    return jsonResponse({ status: 'connected', data: json.data });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Connection test failed', 502);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller's identity directly against the auth server, rather than
    // relying on an unawaited setSession() call with an empty refresh token. That
    // pattern raced with every query below: it left get_ai_provider_key's internal
    // auth.uid() check running under the service-role key (no caller identity),
    // which fails closed sometimes and, when it doesn't, is fragile to depend on
    // as the only authorization check for a service-role client.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return errorResponse('Unauthorized: no Authorization header sent', 401);
    const { data: authData, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !authData.user) {
      console.error('ai-gateway auth check failed:', authError?.message, authError?.status, authError?.name);
      return errorResponse(`Unauthorized: ${authError?.message ?? 'token did not resolve to a user'}`, 401);
    }
    const callerId = authData.user.id;

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'chat';

    if (action === 'models' || action === 'test') {
      const body = await req.json();
      if (!body.workspace_id) return errorResponse('workspace_id is required', 400);
      if (!(await isWorkspaceMember(supabase, body.workspace_id, callerId))) return errorResponse('Forbidden', 403);
      const apiKey = await getApiKey(supabase, body.workspace_id, callerId);
      if (!apiKey) return errorResponse('No API key configured. Add your OpenRouter API key in AI Settings.', 400);
      if (action === 'models') return await handleModels(apiKey);
      return await handleTestConnection(apiKey);
    }

    if (action === 'chat') {
      const body: ChatRequestBody = await req.json();
      if (!body.workspace_id) return errorResponse('workspace_id is required', 400);
      if (!body.messages || body.messages.length === 0) return errorResponse('messages are required', 400);
      if (!(await isWorkspaceMember(supabase, body.workspace_id, callerId))) return errorResponse('Forbidden', 403);

      const apiKey = await getApiKey(supabase, body.workspace_id, callerId);
      if (!apiKey) return errorResponse('No API key configured. Add your OpenRouter API key in AI Settings.', 400);

      const settings = await getAiSettings(supabase, body.workspace_id);
      return await handleChatCompletion(supabase, body, apiKey, settings, callerId);
    }

    return errorResponse('Unknown action. Use ?action=chat|models|test', 400);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});
