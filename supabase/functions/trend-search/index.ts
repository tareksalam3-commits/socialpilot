import { corsHeadersFor, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';
import { getCredential } from '../_shared/credentials.ts';

// Trend Signal — optional add-on alongside the Research Agent
// (researchAgent.ts). That agent is deliberately grounded ONLY in the
// workspace's own configured Content Sources and never invents anything
// beyond them (see its file header) — this endpoint is a separate, clearly
// labeled channel for a different kind of input: what's currently being
// talked about on the open web for a topic/industry, so the Creator can
// consider current relevance without that ever being treated as verified,
// citable fact the way Research evidence is. The client-side renderer
// (trendAgent.ts) is responsible for keeping that framing explicit in the
// prompt; this function's only job is to fetch and shape the raw results.
//
// Provider: Tavily (an AI-oriented search API — short snippets + source
// URLs, not full page scrapes). Entirely optional: with no
// trend_search_api_key/TAVILY_API_KEY configured, this returns
// trend_available: false rather than an error, so a workspace that never
// set this up is completely unaffected — same degrade-gracefully contract
// every other optional pipeline input already follows.

type TrendBody = { workspace_id?: string; query?: string };

type TrendItem = { title: string; url: string; snippet: string; published_date: string | null };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const supabase = serviceClient();
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  const { workspace_id, query }: TrendBody = await req.json().catch(() => ({}));
  if (!workspace_id || !query?.trim()) return errorResponse('workspace_id and query are required', 400);

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspace_id)
    .eq('user_id', callerId)
    .maybeSingle();
  if (!membership) return errorResponse('Forbidden', 403);

  const apiKey = await getCredential(supabase, 'trend_search_api_key');
  if (!apiKey) {
    // Honest "not configured" result, never a fabricated/empty-looking
    // success — mirrors research_available: false in researchAgent.ts.
    return jsonResponse({ trend_available: false, items: [], reason: 'not_configured' }, 200, req);
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query: query.trim().slice(0, 400),
        search_depth: 'basic',
        max_results: 5,
        // Recent content only — a "trend" search returning a 2019 article
        // is worse than useless for this feature's purpose.
        days: 14,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return jsonResponse({ trend_available: false, items: [], reason: body?.error ?? `provider_error_${res.status}` }, 200, req);
    }

    const body = await res.json();
    const results: unknown[] = Array.isArray(body?.results) ? body.results : [];
    const items: TrendItem[] = results
      .slice(0, 5)
      .map((r) => {
        const row = r as Record<string, unknown>;
        return {
          title: typeof row.title === 'string' ? row.title.slice(0, 200) : '',
          url: typeof row.url === 'string' ? row.url : '',
          // Snippets only, deliberately short — this is a "what's being
          // talked about" signal for the model to weigh, not source
          // material to quote from.
          snippet: typeof row.content === 'string' ? row.content.slice(0, 400) : '',
          published_date: typeof row.published_date === 'string' ? row.published_date : null,
        };
      })
      .filter((item) => item.title && item.snippet);

    return jsonResponse({ trend_available: items.length > 0, items, reason: items.length > 0 ? 'ok' : 'no_results' }, 200, req);
  } catch (e) {
    return jsonResponse({ trend_available: false, items: [], reason: e instanceof Error ? e.message : 'fetch_failed' }, 200, req);
  }
});
