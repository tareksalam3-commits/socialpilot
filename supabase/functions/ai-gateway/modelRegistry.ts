// Model Registry — the single source of truth for "which providers exist,
// what does each one look like, and what models does each one currently
// offer". Nothing here talks to ai_provider_keys or ai_settings (that's
// Provider Router) and nothing here makes a chat request (that's the
// Fallback Engine) — this module only knows about provider *metadata* and
// model *listings*.

export type AiProvider = 'openrouter' | 'groq' | 'cerebras' | 'nvidia' | 'mistral' | 'zai' | 'huggingface' | 'direct';

export type ModelInfo = {
  id: string;
  name?: string;
  pricing?: { prompt: string; completion: string };
  context_length?: number;
  // Present on OpenRouter's /models listing; used below to keep pickFreeModels
  // to genuine text-in/text-out chat models — see the filter's own comment.
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
};

export type ProviderCatalogEntry = {
  id: AiProvider;
  label: string;
  base_url: string;
  default_model: string;
  supports_model_list: boolean;
};

export type ProviderKeyRow = {
  provider: AiProvider;
  api_key_encrypted: string | null;
  base_url: string | null;
  account_id: string | null;
};

// Every provider here speaks the same OpenAI-compatible chat/completions
// shape, which is what makes automatic fallback between them possible
// without provider-specific request code (see fallbackEngine/providers/*.ts
// for the handful of per-provider quirks, e.g. OpenRouter's extra headers).
//
// 'direct' is intentionally generic: it's a bring-your-own-endpoint slot for
// any OpenAI-compatible API the person wants to call directly (OpenAI itself,
// an Anthropic/Gemini compatibility shim, a self-hosted vLLM box, etc). Its
// base_url is always taken from the saved key row (see providerRouter.ts) —
// the base_url below is just a placeholder default.
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', default_model: 'openrouter/auto', supports_model_list: true },
  { id: 'groq', label: 'Groq', base_url: 'https://api.groq.com/openai/v1', default_model: 'llama-3.3-70b-versatile', supports_model_list: true },
  { id: 'cerebras', label: 'Cerebras', base_url: 'https://api.cerebras.ai/v1', default_model: 'llama-3.3-70b', supports_model_list: true },
  { id: 'nvidia', label: 'NVIDIA NIM', base_url: 'https://integrate.api.nvidia.com/v1', default_model: 'meta/llama-3.3-70b-instruct', supports_model_list: true },
  { id: 'mistral', label: 'Mistral', base_url: 'https://api.mistral.ai/v1', default_model: 'mistral-small-latest', supports_model_list: true },
  { id: 'zai', label: 'Z.ai', base_url: 'https://api.z.ai/api/paas/v4', default_model: 'glm-5.2', supports_model_list: false },
  { id: 'huggingface', label: 'Hugging Face', base_url: 'https://router.huggingface.co/v1', default_model: 'meta-llama/Llama-3.3-70B-Instruct', supports_model_list: true },
  { id: 'direct', label: 'Direct APIs', base_url: 'https://api.openai.com/v1', default_model: 'gpt-4o-mini', supports_model_list: false },
];

export function catalogFor(id: string): ProviderCatalogEntry {
  return PROVIDER_CATALOG.find((p) => p.id === id) ?? PROVIDER_CATALOG[0];
}

const MODELS_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function authHeaders(entry: ProviderCatalogEntry, apiKey: string): Record<string, string> {
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

export async function fetchModels(entry: ProviderCatalogEntry, keyRow: ProviderKeyRow): Promise<ModelInfo[]> {
  const baseUrl = keyRow.base_url || entry.base_url;
  const res = await fetchWithTimeout(`${baseUrl}/models`, { headers: authHeaders(entry, keyRow.api_key_encrypted!) }, MODELS_TIMEOUT_MS);
  if (!res.ok) throw new Error(`Failed to fetch models: ${res.status}`);
  const json = await res.json();
  return (json.data ?? []) as ModelInfo[];
}

// Free-tier model IDs on OpenRouter aren't all general-purpose chat models —
// moderation/guard classifiers, embedding/rerank models, and vision/audio-only
// models all show up at $0 pricing too, but none of them can carry on a
// "write me an Arabic social post" conversation. Sending them a chat request
// either fails oddly or (worse) comes back 200 OK with garbage/echoed text
// that used to get treated as a real generation. Keep this to models that are
// actually built for open-ended text chat/instruction-following.
const UNSUITABLE_MODEL_ID_PATTERN =
  /guard|moderation|safety|-embed|embedding|rerank|reranker|whisper|\btts\b|text-to-speech|speech-to-text|\baudio\b|\bocr\b|clip|dall-e|stable-diffusion|-vl-|\bvision\b|image-to-|-to-image|video/i;

export function pickFreeModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => {
    const prompt = parseFloat(m.pricing?.prompt ?? '1');
    const completion = parseFloat(m.pricing?.completion ?? '1');
    if (prompt !== 0 || completion !== 0) return false;

    if (UNSUITABLE_MODEL_ID_PATTERN.test(m.id) || (m.name && UNSUITABLE_MODEL_ID_PATTERN.test(m.name))) return false;

    // When OpenRouter tells us the modality, trust it: only keep models that
    // both take and produce text. Older/incomplete listings may omit this —
    // in that case fall through to the ID-pattern filter above rather than
    // excluding the model on missing data.
    const modality = m.architecture?.modality;
    if (modality && modality !== 'text->text') return false;
    const inputs = m.architecture?.input_modalities;
    const outputs = m.architecture?.output_modalities;
    if (inputs && !inputs.includes('text')) return false;
    if (outputs && (outputs.length !== 1 || outputs[0] !== 'text')) return false;

    return true;
  });
}
