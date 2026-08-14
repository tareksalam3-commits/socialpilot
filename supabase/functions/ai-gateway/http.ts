export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL')?.replace(/\/$/, '') || '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function isHardFailure(status: number): boolean {
  // Auth/quota/billing problems — retrying the same key won't help, move on
  // to the next provider immediately instead of burning attempts on it.
  return status === 401 || status === 402 || status === 403 || status === 404;
}

export function isTransientFailure(status: number): boolean {
  return status === 429 || status >= 500;
}

// Some free/unsuited models don't actually follow the chat instruction —
// they just hand the prompt straight back (sometimes verbatim, sometimes as
// a prefix they then trail off from). A 200 OK with non-empty text used to
// be treated as a real success even when this happened, so the user would
// see their own request appear where the generated post should be. This
// normalizes both sides (strip whitespace/punctuation noise, lowercase —
// safe for Arabic since it has no case) and flags the response as an echo,
// never a real generation, when either:
//   (a) the whole response is essentially the whole prompt (near-equal
//       normalized length and one contains the other), or
//   (b) a long-enough leading chunk of the response appears verbatim inside
//       the prompt text (a partial echo that trails off into nothing new).
function normalizeForEchoCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s`"'*_#>\-.,!?؟،؛:]+/g, ' ')
    .trim();
}

// Reasoning-tuned models (DeepSeek-R1 style, common among the free/router
// models this app picks via pickFreeModels) emit their internal "thinking"
// as plain text inside message.content itself, wrapped in <think>...</think>
// (or the <thinking> variant) — there's no separate reasoning field to skip.
// Left unstripped, this is exactly what ends up saved as the post body
// instead of the actual generated post. Applied to the full non-streaming
// content before it's ever handed back to the client.
const THINK_BLOCK_RE = /<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi;
// Some responses only ever emit the opening tag (the model was cut off, or
// never closed it) — in that case everything from the tag onward is
// reasoning, not post content, so drop the tail rather than keep an
// unclosed fragment.
const UNCLOSED_THINK_RE = /<think(?:ing)?>[\s\S]*$/i;

export function stripReasoningLeak(text: string): string {
  return text.replace(THINK_BLOCK_RE, '').replace(UNCLOSED_THINK_RE, '').trim();
}

export function isEchoOfPrompt(responseText: string, promptMessages: { content: string }[]): boolean {
  const normalizedResponse = normalizeForEchoCheck(responseText);
  if (normalizedResponse.length < 20) return false; // too short to judge either way

  const promptText = promptMessages.map((m) => m.content).join(' \n ');
  const normalizedPrompt = normalizeForEchoCheck(promptText);
  if (!normalizedPrompt) return false;

  // (a) near-total echo of the whole prompt (or the whole response is a
  // substring of the prompt and covers most of it)
  if (normalizedPrompt.includes(normalizedResponse) && normalizedResponse.length >= normalizedPrompt.length * 0.5) {
    return true;
  }

  // (b) a long verbatim leading chunk of the response was lifted straight
  // from the prompt — real generations essentially never share a 120+
  // character run with their own instructions/user request verbatim.
  const probeLen = Math.min(120, normalizedResponse.length);
  if (probeLen >= 60) {
    const leadingChunk = normalizedResponse.slice(0, probeLen);
    if (normalizedPrompt.includes(leadingChunk)) return true;
  }

  return false;
}
