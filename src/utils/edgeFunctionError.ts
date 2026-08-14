import { FunctionsHttpError } from '@supabase/supabase-js';

/**
 * supabase-js's `functions.invoke()` throws a `FunctionsHttpError` whenever
 * the Edge Function responds with a non-2xx status, and that error's
 * `.message` is ALWAYS the generic string "Edge Function returned a non-2xx
 * status code" — it never contains the actual reason. The real reason (our
 * edge functions reply with `{ error: "..." }`) lives in the raw fetch
 * `Response` object at `error.context`, which supabase-js never reads for
 * you, so callers see only the generic wrapper text unless they dig it out
 * themselves.
 *
 * This pulls the real `error` (or `message`) field out of that response
 * body, falling back to the generic message only if the body can't be
 * parsed for some reason.
 */
export async function describeEdgeFunctionError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError && error.context instanceof Response) {
    try {
      const body = await error.context.clone().json();
      if (typeof body?.error === 'string' && body.error.trim()) return body.error;
      if (typeof body?.message === 'string' && body.message.trim()) return body.message;
    } catch {
      // Body wasn't JSON — fall back to raw text below.
    }
    try {
      const text = await error.context.clone().text();
      if (text.trim()) return text;
    } catch {
      // Body already consumed or unreadable — fall through to generic message.
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
