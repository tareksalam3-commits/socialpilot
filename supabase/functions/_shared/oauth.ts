import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getCredential } from './credentials.ts';

// These endpoints are called with a bearer token (Authorization header), not
// browser cookies, so a permissive CORS policy doesn't expose a CSRF/session
// hijack risk the way it would for cookie-authenticated APIs — a page on
// another origin still can't forge a valid Authorization header. Even so, we
// don't reflect an unlimited wildcard: only the app's own configured
// origin(s) get the header back, which keeps the response's JSON body from
// being readable by an arbitrary third-party site's client-side JS.
//
// `corsHeaders` (static) is kept for the many call sites that don't have the
// incoming Request handy. It still sets Access-Control-Allow-Origin — to
// APP_URL when configured, falling back to '*' only when it isn't (so
// nothing breaks on a workspace that hasn't set APP_URL yet). Prefer
// `corsHeadersFor(req)` below wherever the Request is available, since it
// validates against the actual caller's Origin instead of a single static
// value or an open wildcard.
export const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_URL')?.replace(/\/$/, '') || '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
  'Vary': 'Origin',
};

/** Local dev servers (Vite default + common alternates) are always allowed
 * alongside whatever APP_URL is configured, so local development never
 * needs its own env var. */
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000'];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (DEV_ORIGINS.includes(origin)) return true;
  const appUrl = Deno.env.get('APP_URL');
  if (appUrl && origin === appUrl.replace(/\/$/, '')) return true;
  return false;
}

/** Per-request CORS headers: reflects the caller's Origin only if it's the
 * configured app URL or a local dev server, otherwise omits the
 * Access-Control-Allow-Origin header entirely (which makes the response
 * body unreadable to browser JS on any other origin — the request itself
 * still succeeds server-side, e.g. for non-browser callers). */
export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  if (isAllowedOrigin(origin)) {
    return { ...corsHeaders, 'Access-Control-Allow-Origin': origin as string };
  }
  return { ...corsHeaders };
}

export function jsonResponse(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...(req ? corsHeadersFor(req) : corsHeaders), 'Content-Type': 'application/json' },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/** Redirect back into the app's Connected Accounts page with an outcome.
 * Resolves the base URL from Settings > Integrations first, falling back
 * to the APP_URL env var if nothing's been saved there yet. */
export async function redirectToApp(supabase: SupabaseClient, params: Record<string, string>): Promise<Response> {
  const appUrl = (await getCredential(supabase, 'app_url')) ?? '';
  const url = new URL(`${appUrl.replace(/\/$/, '')}/app/accounts`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

export function serviceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Verifies the caller's bearer token and returns their user id, or null. */
export async function getCallerId(supabase: SupabaseClient, req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  const { data, error } = await supabase.auth.getUser(authHeader.slice(7));
  if (error || !data.user) return null;
  return data.user.id;
}

export function randomState(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}
