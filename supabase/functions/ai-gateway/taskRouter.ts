// Task Router — the front door for every ai-gateway request. It parses the
// `action` query param, does the lightweight per-action authorization
// (workspace membership for chat/image, super-admin for provider
// management), and dispatches to the right engine/module. No provider or
// fallback logic lives here — this file only decides *what kind* of request
// this is and *who's allowed to make it*.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { jsonResponse, errorResponse, fetchWithTimeout } from './http.ts';
import { PROVIDER_CATALOG, catalogFor, fetchModels, pickFreeModels, authHeaders, type AiProvider, type ProviderKeyRow } from './modelRegistry.ts';
import { getAiSettings, getProviderKeys, buildProviderChain } from './providerRouter.ts';
import { runChatFallback, type ChatMessage } from './fallbackEngine/index.ts';

const TEST_TIMEOUT_MS = 10_000;
const IMAGE_TIMEOUT_MS = 45_000;

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
  content_text?: string | null;
  // 'qc' marks this request as the independent Quality Control review of an
  // already-authored draft — see handleChat below for how this changes
  // model resolution (ai_settings.qc_model instead of default_model, plus
  // the exclude_model guarantee).
  task?: 'creator' | 'qc' | 'other';
  // The model that actually authored the content being reviewed (only
  // meaningful together with task: 'qc'). The Fallback Engine will never
  // settle on this exact model for the request — it swaps to another
  // available model/provider instead, so Quality Control is never the
  // same model grading its own work.
  exclude_model?: string;
};

type ImageRequestBody = {
  workspace_id: string;
  prompt: string;
  width?: number;
  height?: number;
};

// AI-generated post images (the Assistant's "Create Images" step) — a
// no-API-key text-to-image endpoint, kept separate from the chat providers
// since none of them expose image generation over an OpenAI-compatible
// endpoint. Images are streamed straight into the workspace's existing
// `media` Storage bucket, so the result is a normal Media Library item like
// any manual upload.
const IMAGE_PROVIDER_BASE_URL = 'https://image.pollinations.ai/prompt';

async function isWorkspaceMember(supabase: ReturnType<typeof createClient>, workspaceId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return !!data;
}

async function isSuperAdmin(supabase: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('platform_role').eq('user_id', userId).maybeSingle();
  return data?.platform_role === 'super_admin';
}

function buildMessages(body: ChatRequestBody): ChatMessage[] {
  const languageRule =
    'Language rule: reply in the same language the user\'s content/topic is written in. ' +
    'Only switch languages if the task explicitly asks for a translation or explicitly names a different output language — follow that explicit instruction in that case instead.';

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
- Emoji style: ${bv.emoji_style ?? 'minimal'}

${languageRule}`;
    messages = [{ role: 'system', content: systemContent }, ...messages];
  } else {
    messages = [{ role: 'system', content: languageRule }, ...messages];
  }

  if (body.content_text && body.content_text.trim()) {
    // Cap what we forward — this is summarized/excerpted content coming out of
    // Content Sources already, so it should be short, but guard against an
    // oversized paste blowing the request budget regardless.
    const sourceContent = body.content_text.trim().slice(0, 12_000);
    messages = [
      {
        role: 'system',
        content:
          'The user has selected the following source content (from an article, document, or video ' +
          'transcript) to base their request on. Use it as your factual reference material; do not ' +
          'invent facts beyond it:\n\n---\n' + sourceContent + '\n---',
      },
      ...messages,
    ];
  }

  return messages;
}

async function handleChat(
  supabase: ReturnType<typeof createClient>,
  body: ChatRequestBody,
  callerId: string,
): Promise<Response> {
  if (!body.workspace_id) return errorResponse('workspace_id is required', 400);
  if (!body.messages || body.messages.length === 0) return errorResponse('messages are required', 400);
  if (!(await isWorkspaceMember(supabase, body.workspace_id, callerId))) return errorResponse('Forbidden', 403);

  const settings = await getAiSettings(supabase);
  const providerKeys = await getProviderKeys(supabase);

  const preferredProvider = (body.provider || settings?.provider || 'openrouter') as AiProvider;
  const modelSelection = (settings?.model_selection ?? 'auto') as 'auto' | 'manual';
  // 'manual' means the Super Admin has pinned a specific provider/model — no
  // cross-provider fallback in that case, only the chosen one is attempted.
  // 'auto' keeps the full dynamic fallback chain across every configured provider.
  const chain = modelSelection === 'manual' ? buildProviderChain(preferredProvider, providerKeys).slice(0, 1) : buildProviderChain(preferredProvider, providerKeys);

  // Quality Control Model Separation: a QC request never resolves to the
  // authoring model. Preference order for the model to try:
  //   1. an explicit model on the request itself (body.model)
  //   2. ai_settings.qc_model — the Super Admin's dedicated QC model
  //   3. ai_settings.default_model — same as every other task
  // Whichever one wins, exclude_model (the model that actually authored
  // this content, when known) is always forwarded so the Fallback Engine
  // guarantees the final attempt never lands on that exact model — see
  // fallbackEngine/index.ts.
  const isQc = body.task === 'qc';
  const requestedModel = body.model || (isQc ? settings?.qc_model || settings?.default_model : settings?.default_model);
  // Belt-and-suspenders: if the QC model explicitly configured/resolved
  // happens to be identical to the model that authored the content (e.g.
  // qc_model left unset and it resolved to the same default_model), don't
  // even hand it to the Fallback Engine as the "requested" pin — let it
  // auto-pick a different one instead of retrying the same model 3 times.
  const effectiveRequestedModel = isQc && body.exclude_model && requestedModel === body.exclude_model ? undefined : requestedModel;

  return runChatFallback(supabase, {
    workspaceId: body.workspace_id,
    userId: callerId,
    chain,
    preferredProvider,
    providerKeys,
    messages: buildMessages(body),
    temperature: body.temperature ?? settings?.temperature ?? 0.7,
    maxTokens: body.max_tokens ?? settings?.max_tokens ?? 1024,
    stream: body.stream ?? settings?.streaming ?? true,
    freeOnly: body.free_only ?? settings?.free_only_mode ?? true,
    modelSelection,
    requestedModel: effectiveRequestedModel,
    excludeModel: isQc ? body.exclude_model : undefined,
    lastSuccessfulProvider: settings?.last_successful_provider,
    lastSuccessfulModel: settings?.last_successful_model,
  });
}

async function handleModels(providerId: AiProvider, keyRow: ProviderKeyRow): Promise<Response> {
  const entry = catalogFor(providerId);
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
  providerId: AiProvider,
  keyRow: ProviderKeyRow,
): Promise<Response> {
  const entry = catalogFor(providerId);
  const markResult = async (status: 'connected' | 'failed') => {
    await supabase
      .from('ai_provider_keys')
      .update({ last_test_status: status, last_tested_at: new Date().toISOString() })
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

async function handleImageGeneration(
  supabase: ReturnType<typeof createClient>,
  body: ImageRequestBody,
  callerId: string,
): Promise<Response> {
  if (!body.workspace_id) return errorResponse('workspace_id is required', 400);
  if (!(await isWorkspaceMember(supabase, body.workspace_id, callerId))) return errorResponse('Forbidden', 403);

  const prompt = (body.prompt || '').trim();
  if (!prompt) return errorResponse('prompt is required', 400);

  const width = Math.min(1440, Math.max(256, Math.round(body.width || 1024)));
  const height = Math.min(1440, Math.max(256, Math.round(body.height || 1024)));
  const seed = Math.floor(Math.random() * 1_000_000_000);
  const imageUrl = `${IMAGE_PROVIDER_BASE_URL}/${encodeURIComponent(prompt)}?width=${width}&height=${height}&nologo=true&seed=${seed}`;

  let bytes: ArrayBuffer;
  try {
    const res = await fetchWithTimeout(imageUrl, { method: 'GET' }, IMAGE_TIMEOUT_MS);
    if (!res.ok) return errorResponse(`Image generation failed (${res.status})`, 502);
    bytes = await res.arrayBuffer();
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Image generation timed out', 502);
  }

  const path = `${body.workspace_id}/ai-generated/${Date.now()}-${seed}.png`;
  const { error: uploadError } = await supabase.storage.from('media').upload(path, bytes, {
    contentType: 'image/png',
    upsert: false,
  });
  if (uploadError) return errorResponse(`Could not save generated image: ${uploadError.message}`, 500);

  const { data: urlData } = supabase.storage.from('media').getPublicUrl(path);
  return jsonResponse({ url: urlData.publicUrl, width, height, provider: 'pollinations' });
}

export async function routeTask(action: string, req: Request, supabase: ReturnType<typeof createClient>, callerId: string): Promise<Response> {
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
    // Provider/model management is platform-wide — Super Admin only, not
    // gated by workspace membership.
    if (!(await isSuperAdmin(supabase, callerId))) return errorResponse('Forbidden', 403);
    const body = await req.json();

    const settings = await getAiSettings(supabase);
    const providerKeys = await getProviderKeys(supabase);
    const providerId = (body.provider || settings?.provider || 'openrouter') as AiProvider;
    const entry = catalogFor(providerId);
    const keyRow = providerKeys.get(providerId);
    if (!keyRow?.api_key_encrypted) return errorResponse(`No API key configured for ${entry.label}. Add it in AI Providers.`, 400);

    if (action === 'models') return await handleModels(providerId, keyRow);
    return await handleTestConnection(supabase, providerId, keyRow);
  }

  if (action === 'chat') {
    const body: ChatRequestBody = await req.json();
    return await handleChat(supabase, body, callerId);
  }

  if (action === 'image') {
    const body: ImageRequestBody = await req.json();
    return await handleImageGeneration(supabase, body, callerId);
  }

  return errorResponse('Unknown action. Use ?action=chat|image|models|test|providers', 400);
}
