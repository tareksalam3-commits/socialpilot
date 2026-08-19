/**
 * Serper.dev Search Connector — real search_web / fetch_public_page tools
 * ========================================================================
 * This is a TOOL, not the brain (§20, §22). It returns raw Google SERP
 * results (title/link/snippet) exactly as Google shows them — it never
 * decides who is a "person", what their occupation is, or where they
 * live. That reading/extraction work belongs to the AI step in
 * researchAgent.ts (§4, §9).
 *
 * Honesty (§21, §28): if no API key is configured for this connector,
 * `search()` throws NOT_CONFIGURED — the caller (researchAgent.ts loop)
 * already treats a thrown error from `connector.search` as a per-source
 * error stat and moves on; it never fabricates a result.
 *
 * Registered under connector_key = 'serper_search' in `lead_sources`.
 * The API key is stored per-workspace in `lead_source_secrets` (existing
 * schema, service-role only) via the existing Lead Hunter Admin "Sources"
 * form — no new secret-storage mechanism needed.
 */

import type { LeadSourceConnector, RawCandidate, SearchSpecification, SourceCredentials } from '../researchAgent.ts';
import type { LeadRecord } from '../pipeline.ts';

const SERPER_ENDPOINT = 'https://google.serper.dev/search';
const REQUEST_TIMEOUT_MS = 12_000;

export class SerperNotConfiguredError extends Error {
  constructor() {
    super('NOT_CONFIGURED');
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
  }
}

export type SerperOrganicResult = {
  title: string;
  link: string;
  snippet: string;
  position?: number;
};

/**
 * search_web tool — hits Serper's Google SERP API. `gl=eg`/`hl=ar` bias
 * results toward Egypt + Arabic since that's the only market this agent
 * currently operates in (matches EGYPT_GOVERNORATES in pipeline.ts);
 * nothing about the connector itself is Egypt-specific.
 */
export async function serperSearchWeb(query: string, apiKey: string, page = 1): Promise<SerperOrganicResult[]> {
  if (!apiKey) throw new SerperNotConfiguredError();
  const res = await withTimeout(
    fetch(SERPER_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'eg', hl: 'ar', num: 20, page }),
    }),
    REQUEST_TIMEOUT_MS,
  );
  if (res.status === 401 || res.status === 403) throw new SerperNotConfiguredError();
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = (await res.json()) as { organic?: SerperOrganicResult[] };
  return Array.isArray(data.organic) ? data.organic : [];
}

/**
 * fetch_public_page tool — used sparingly, only to gather Verification
 * evidence for a strong-but-unconfirmed candidate (§10, §22). Publicly
 * reachable pages only; no login, no CAPTCHA bypass, no auth headers.
 * Returns plain text capped in length to keep AI prompt cost bounded.
 */
export async function fetchPublicPage(url: string, maxChars = 4000): Promise<{ text: string; finalUrl: string } | null> {
  try {
    const res = await withTimeout(
      fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadHunterResearchAgent/1.0)' } }),
      REQUEST_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { text: text.slice(0, maxChars), finalUrl: res.url };
  } catch {
    return null;
  }
}

/**
 * The connector itself only ever returns raw SERP rows wrapped as
 * RawCandidate (§22: source is a tool, not the researcher). Turning a
 * title/link/snippet into a structured, evidence-backed person record is
 * the AI extraction step the loop runs afterward — see runResearchLoop's
 * `extract_candidates` call in researchAgent.ts.
 */
export function createSerperConnector(): LeadSourceConnector {
  return {
    key: 'serper_search',
    async search(query: string, _spec: SearchSpecification, credentials: SourceCredentials): Promise<RawCandidate[]> {
      const apiKey = credentials.apiKey;
      if (!apiKey) throw new SerperNotConfiguredError();
      const results = await serperSearchWeb(query, apiKey);
      return results.map((r) => ({
        source_url: r.link,
        evidence: r.snippet,
        _serp_title: r.title,
        _serp_query: query,
      }));
    },
    // normalize/validate are unused for this connector — extraction needs
    // AI reasoning over the snippet (§4), so the research loop bypasses
    // these two and calls the AI `extract_candidates` step directly on
    // the raw SERP rows instead. Kept only to satisfy the shared
    // LeadSourceConnector type used by other (future, structured-data)
    // connectors that don't need AI extraction.
    async normalize(record: RawCandidate): Promise<LeadRecord> {
      return { source_url: record.source_url, notes: record.evidence };
    },
    async validate(): Promise<{ valid: boolean; errors: string[] }> {
      return { valid: false, errors: ['يتطلب استخراج AI قبل الاعتماد — لا يُستخدم هذا المسار للنتائج الخام.'] };
    },
  };
}
