import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const REQUEST_TIMEOUT_MS = 60_000;
const MODELS_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 10_000;
const MAX_MODEL_ATTEMPTS_PER_PROVIDER = 3;
const RETRY_DELAY_MS = 600;

type AiProvider = 'openrouter' | 'groq' | 'cerebras' | 'nvidia' | 'mistral' | 'zai';

type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };
type ChatRequestBody = {
  workspace_id: string;
  messages: ChatMessage[];
  provider?: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  free_only?: boolean;
  brand_voice?: Record<string, unknown> | null;
};

type ModelInfo = {
  id: string;
  name?: string;
  pricing?: { prompt: string; completion: string };
  context_length?: number;
};

type ProviderCatalogEntry = {
  id: AiProvider;
  label: string;
  base_url: string;
  default_model: string;
  supports_model_list: boolean;
};

// Every provider here speaks the same OpenAI-compatible chat/completions
// shape, which is what makes automatic fallback between them possible
// without provider-specific request code.
const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', default_model: 'openrouter/auto', supports_model_list: true },
  { id: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1', default_model: 'llama-3.3-70b-versatile', supports_model_list: true },
  { id: 'cerebras', label: 'Cerebras', base_url: 'https://api.cerebras.ai/v1', default_model: 'llama-3.3-70b', supports_model_list: true },
  { id: 'nvidia', label: 'NVIDIA NIM', base_url: 'https://integrate.api.nvidia.com/v1', default_model: 'meta/llama-3.3-70b-instruct', supports_model_list: true },
  { id: 'mistral', label: 'Mistral', base_url: 'https://api.mistral.ai/v1', default_model: 'mistral-small-latest', supports_model_list: true },
  { id: 'zai', label: 'Z.ai', base_url: 'https://api.z.ai/api/paas/v4', default_model: 'glm-5.2', supports_model_list: false },
];

type ProviderKeyRow = {
  provider: AiProvider;
  api_key_encrypted: string | null;
  base_url: string | null;
  account_id: string | null;
};

function catalogFor(id: string): ProviderCatalogEntry {
  return PROVIDER_CATALOG.find((p) => p.id === id) ?? PROVIDER_CATALOG[0];
}

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

// Service-role client bypasses RLS, so this reads ai_provider_keys directly —
// no SECURITY DEFINER RPC needed for the gateway's own use (the RPC
// `list_ai_provider_status` exists only for the browser client, which has no
// SELECT access to this table at all).
async function getProviderKeys(supabase: ReturnType<typeof createClient>, workspaceId: string): Promise<Map<AiProvider, ProviderKeyRow>> {
  const { data, error } = await supabase
    .from('ai_provider_keys')
    .select('provider, api_key_encrypted, base_url, account_id')
    .eq('workspace_id', workspaceId);
  const map = new Map<AiProvider, ProviderKeyRow>();
  if (error || !data) return map;
  for (const row of data as ProviderKeyRow[]) map.set(row.provider, row);
  return map;
}

async function getAiSettings(supabase: ReturnType<typeof createClient>, workspaceId: string) {
  const { data, error } = await supabase
    .from('ai_settings')
    .select('provider, default_model, temperature, max_tokens, streaming, free_only_mode, mode, last_successful_model, last_successful_provider')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) return null;
  return data;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
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

function authHeaders(entry: ProviderCatalogEntry, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (entry.id === 'openrouter') {
    headers['HTTP-Referer'] = 'https://socialpilot.ai';
    headers['X-Title'] = 'SocialPilot AI';
  }
  return headers;
}

async function fetchModels(entry: ProviderCatalogEntry, keyRow: ProviderKeyRow): Promise<ModelInfo[]> {
  const baseUrl = keyRow.base_url || entry.base_url;
  const res = await fetchWithTimeout(`${baseUrl}/models`, { headers: authHeaders(entry, keyRow.api_key_encrypted!) }, MODELS_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const json = await res.json();
  return (json.data ?? []) as ModelInfo[];
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

async function updateLastSuccessful(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  provider: string,
  model: string,
): Promise<void> {
  await supabase
    .from('ai_settings')
    .update({ last_successful_model: model, last_successful_provider: provider, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId);
}

// Ordered list of providers to actually try for this request: the caller's
// preferred provider first (if it has a key configured), then every other
// configured provider, in catalog order. Providers with no key saved are
// skipped entirely — that's the "switch to one that works, invisibly to the
// user" behavior.
function buildProviderChain(preferred: string | undefined, keys: Map<AiProvider, ProviderKeyRow>): AiProvider[] {
  const configured = PROVIDER_CATALOG.map((p) => p.id).filter((id) => !!keys.get(id)?.api_key_encrypted);
  const chain: AiProvider[] = [];
  if (preferred && configured.includes(preferred as AiProvider)) chain.push(preferred as AiProvider);
  for (const id of configured) if (!chain.includes(id)) chain.push(id);
  return chain;
}

function isHardFailure(status: number): boolean {
  // Auth/quota/billing problems — retrying the same key won't help, move on
  // to the next provider immediately instead of burning attempts on it.
  return status === 401 || status === 402 || status === 403 || status === 404;
}

function isTransientFailure(status: number): boolean {
  return status === 429 || status >= 500;
}

async function handleChatCompletion(
  supabase: ReturnType<typeof createClient>,
  body: ChatRequestBody,
  settings: Awaited<ReturnType<typeof getAiSettings>>,
  providerKeys: Map<AiProvider, ProviderKeyRow>,
  userId: string,
): Promise<Response> {
  const preferredProvider = (body.provider || settings?.provider || 'openrouter') as AiProvider;
  const chain = buildProviderChain(preferredProvider, providerKeys);

  if (chain.length === 0) {
    return errorResponse('No API key configured for any AI provider. Add one in AI Settings.', 400);
  }

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

  for (const providerId of chain) {
    const entry = catalogFor(providerId);
    const keyRow = providerKeys.get(providerId)!;
    const isPreferred = providerId === preferredProvider;
    const requestedModel = isPreferred ? body.model || settings?.default_model : undefined;

    let modelsToTry: string[] = [];

    if (providerId === 'openrouter' && freeOnly && (!requestedModel || requestedModel === 'openrouter/auto')) {
      try {
        const allModels = await fetchModels(entry, keyRow);
        const freeModels = pickFreeModels(allModels);
        const lastGood = settings?.last_successful_provider === 'openrouter' ? settings?.last_successful_model : null;
        if (lastGood && freeModels.some((m) => m.id === lastGood)) {
          modelsToTry = [lastGood, ...freeModels.map((m) => m.id).filter((id) => id !== lastGood)];
        } else {
          modelsToTry = freeModels.map((m) => m.id);
        }
      } catch {
        // fall back to the provider default below
      }
      if (modelsToTry.length === 0) modelsToTry = [entry.default_model];
    } else if (requestedModel) {
      modelsToTry = [requestedModel];
    } else if (settings?.last_successful_provider === providerId && settings?.last_successful_model) {
      modelsToTry = [settings.last_successful_model, entry.default_model];
    } else {
      modelsToTry = [entry.default_model];
    }

    const attempts = modelsToTry.slice(0, MAX_MODEL_ATTEMPTS_PER_PROVIDER);

    for (const currentModel of attempts) {
      try {
        const res = await fetchWithTimeout(
          `${keyRow.base_url || entry.base_url}/chat/completions`,
          {
            method: 'POST',
            headers: authHeaders(entry, keyRow.api_key_encrypted!),
            body: JSON.stringify({ model: currentModel, messages, temperature, max_tokens: maxTokens, stream }),
          },
          REQUEST_TIMEOUT_MS,
        );

        if (!res.ok) {
          const errText = await res.text();
          lastError = `${entry.label} ${res.status}: ${errText}`;
          if (isTransientFailure(res.status)) {
            await delay(RETRY_DELAY_MS);
            continue; // try the next model on this same provider
          }
          if (isHardFailure(res.status)) break; // dead key/quota — jump to the next provider
          continue;
        }

        const responseTime = Date.now() - startTime;

        if (stream) {
          const readableStream = new ReadableStream({
            async start(controller) {
              const reader = res.body!.getReader();
              const decoder = new TextDecoder();
              let totalContent = '';
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  totalContent += decoder.decode(value, { stream: true });
                  controller.enqueue(value);
                }
              } catch (e) {
                controller.error(e);
                return;
              }
              controller.close();
              const tokensOut = estimateTokens(totalContent);
              const tokensIn = estimateTokens(JSON.stringify(messages));
              await updateLastSuccessful(supabase, body.workspace_id, providerId, currentModel);
              await recordUsage(supabase, body.workspace_id, userId, {
                model: currentModel,
                provider: providerId,
                tokens_in: tokensIn,
                tokens_out: tokensOut,
                cost: 0,
                status: 'success',
                response_time_ms: responseTime,
                prompt_type: 'chat',
              });
            },
          });
          return new Response(readableStream, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'text/event-stream',
              'X-Model': currentModel,
              'X-Provider': providerId,
              'X-Response-Time': String(responseTime),
            },
          });
        }

        const json = await res.json();
        const content = json.choices?.[0]?.message?.content ?? '';
        const tokensIn = json.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages));
        const tokensOut = json.usage?.completion_tokens ?? estimateTokens(content);
        await updateLastSuccessful(supabase, body.workspace_id, providerId, currentModel);
        await recordUsage(supabase, body.workspace_id, userId, {
          model: currentModel,
          provider: providerId,
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
          provider: providerId,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          response_time_ms: responseTime,
        });
      } catch (e) {
        lastError = e instanceof Error ? e.message : 'Unknown error';
        continue; // network error / timeout — try the next model or provider
      }
    }
    // this provider's models are all exhausted — fall through to the next configured provider
  }

  const responseTime = Date.now() - startTime;
  if (userId) {
    await recordUsage(supabase, body.workspace_id, userId, {
      model: body.model || 'unknown',
      provider: preferredProvider,
      tokens_in: 0,
      tokens_out: 0,
      cost: 0,
      status: 'failed',
      response_time_ms: responseTime,
      prompt_type: 'chat',
    });
  }
  return errorResponse(lastError ?? 'Every configured AI provider failed for this request.', 502);
}

async function handleModels(entry: ProviderCatalogEntry, keyRow: ProviderKeyRow): Promise<Response> {
  if (!entry.supports_model_list) {
    return jsonResponse({ models: [], free_count: 0, total_count: 0 });
  }
  try {
    const models = await fetchModels(entry, keyRow);
    const freeModels = entry.id === 'openrouter' ? pickFreeModels(models) : [];
    return jsonResponse({
      models: models.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        context_length: m.context_length,
        is_free: entry.id === 'openrouter' ? parseFloat(m.pricing?.prompt ?? '1') === 0 && parseFloat(m.pricing?.completion ?? '1') === 0 : false,
        pricing: m.pricing,
      })),
      free_count: freeModels.length,
      total_count: models.length,
    });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Failed to fetch models', 502);
  }
}

async function handleTestConnection(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  entry: ProviderCatalogEntry,
  keyRow: ProviderKeyRow,
): Promise<Response> {
  const markResult = async (status: 'connected' | 'failed') => {
    await supabase
      .from('ai_provider_keys')
      .update({ last_test_status: status, last_tested_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('provider', entry.id);
  };
  try {
    // Providers without a dedicated key-check endpoint are tested with a
    // minimal real chat request instead — a 401/403 there means the key
    // itself is bad, which is what "connected" is actually verifying.
    const res =
      entry.id === 'openrouter'
        ? await fetchWithTimeout(`${keyRow.base_url || entry.base_url}/key`, { headers: authHeaders(entry, keyRow.api_key_encrypted!) }, TEST_TIMEOUT_MS)
        : await fetchWithTimeout(
            `${keyRow.base_url || entry.base_url}/chat/completions`,
            {
              method: 'POST',
              headers: authHeaders(entry, keyRow.api_key_encrypted!),
              body: JSON.stringify({ model: entry.default_model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
            },
            TEST_TIMEOUT_MS,
          );

    if (!res.ok && (res.status === 401 || res.status === 403)) {
      await markResult('failed');
      return errorResponse(`Connection failed: ${res.status}`, res.status);
    }
    await markResult('connected');
    const json = await res.json().catch(() => null);
    return jsonResponse({ status: 'connected', data: json });
  } catch (e) {
    await markResult('failed');
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

    if (action === 'providers') {
      return jsonResponse({
        providers: PROVIDER_CATALOG.map((p) => ({
          id: p.id,
          label: p.label,
          default_model: p.default_model,
          supports_model_list: p.supports_model_list,
        })),
      });
    }

    if (action === 'models' || action === 'test') {
      const body = await req.json();
      if (!body.workspace_id) return errorResponse('workspace_id is required', 400);
      if (!(await isWorkspaceMember(supabase, body.workspace_id, callerId))) return errorResponse('Forbidden', 403);

      const settings = await getAiSettings(supabase, body.workspace_id);
      const providerKeys = await getProviderKeys(supabase, body.workspace_id);
      const providerId = (body.provider || settings?.provider || 'openrouter') as AiProvider;
      const entry = catalogFor(providerId);
      const keyRow = providerKeys.get(providerId);
      if (!keyRow?.api_key_encrypted) return errorResponse(`No API key configured for ${entry.label}. Add it in AI Settings.`, 400);

      if (action === 'models') return await handleModels(entry, keyRow);
      return await handleTestConnection(supabase, body.workspace_id, entry, keyRow);
    }

    if (action === 'chat') {
      const body: ChatRequestBody = await req.json();
      if (!body.workspace_id) return errorResponse('workspace_id is required', 400);
      if (!body.messages || body.messages.length === 0) return errorResponse('messages are required', 400);
      if (!(await isWorkspaceMember(supabase, body.workspace_id, callerId))) return errorResponse('Forbidden', 403);

      const settings = await getAiSettings(supabase, body.workspace_id);
      const providerKeys = await getProviderKeys(supabase, body.workspace_id);
      return await handleChatCompletion(supabase, body, settings, providerKeys, callerId);
    }

    return errorResponse('Unknown action. Use ?action=chat|models|test|providers', 400);
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});
