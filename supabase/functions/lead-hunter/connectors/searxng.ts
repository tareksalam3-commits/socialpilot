import type { LeadSourceConnector, RawCandidate, SearchSpecification, SourceCredentials } from '../researchAgent.ts';
import type { LeadRecord } from '../pipeline.ts';

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_PAGE_CHARS = 6_000;
const MAX_RETRIES = 2;

export type SearXNGResult = {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
  publishedDate?: string;
};

export class SearXNGError extends Error {
  readonly code: 'NOT_CONFIGURED' | 'SOURCE_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'NO_RESULTS' | 'PERMISSION_ERROR';
  constructor(code: SearXNGError['code'], message = code) {
    super(message);
    this.name = 'SearXNGError';
    this.code = code;
  }
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function backoffMs(attempt: number): number {
  return 250 * (2 ** attempt) + Math.floor(Math.random() * 100);
}

async function fetchWithRetry(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (response.status === 429) {
        if (attempt < MAX_RETRIES) { await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt))); continue; }
        throw new SearXNGError('RATE_LIMITED', 'SearXNG rate limit reached.');
      }
      return response;
    } catch (error) {
      lastError = error;
      if (error instanceof SearXNGError) throw error;
      if (attempt < MAX_RETRIES) { await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt))); continue; }
      if (error instanceof DOMException && error.name === 'AbortError') throw new SearXNGError('TIMEOUT', 'SearXNG request timed out.');
      throw new SearXNGError('SOURCE_ERROR', error instanceof Error ? error.message : 'SearXNG request failed.');
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SearXNGError('SOURCE_ERROR', lastError instanceof Error ? lastError.message : 'SearXNG request failed.');
}

export async function searxngSearch(query: string, credentials: SourceCredentials, page = 1): Promise<SearXNGResult[]> {
  const baseUrl = normalizeBaseUrl(credentials.baseUrl);
  if (!baseUrl) throw new SearXNGError('NOT_CONFIGURED', 'SEARXNG_BASE_URL is not configured.');
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'ar-EG');
  url.searchParams.set('pageno', String(Math.max(1, page)));
  url.searchParams.set('safesearch', '1');
  const response = await fetchWithRetry(url.toString(), { headers: { Accept: 'application/json' } });
  if (response.status === 401 || response.status === 403) throw new SearXNGError('PERMISSION_ERROR', `SearXNG HTTP ${response.status}.`);
  if (!response.ok) throw new SearXNGError('SOURCE_ERROR', `SearXNG HTTP ${response.status}.`);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new SearXNGError('SOURCE_ERROR', 'SearXNG returned invalid JSON.'); }
  const results = (payload as { results?: SearXNGResult[] } | null)?.results;
  if (!Array.isArray(results)) throw new SearXNGError('SOURCE_ERROR', 'SearXNG JSON has no results array.');
  return results;
}

export async function fetchPublicPage(url: string, maxChars = MAX_PAGE_CHARS): Promise<{ text: string; finalUrl: string } | null> {
  try {
    const response = await fetchWithRetry(url, {
      redirect: 'follow',
      headers: { Accept: 'text/html,text/plain;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; SocialPilotLeadHunter/1.0)' },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;
    const html = await response.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
    return { text: text.slice(0, maxChars), finalUrl: response.url || url };
  } catch {
    return null;
  }
}

export async function searxngHealthCheck(baseUrl: string | null | undefined): Promise<{ status: 'healthy' | 'degraded' | 'error' | 'not_configured'; message: string }> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return { status: 'not_configured', message: 'لم يتم ضبط عنوان SearXNG.' };
  try {
    const response = await fetchWithRetry(`${normalized}/search?q=SocialPilot&format=json&language=en-US&pageno=1`, { headers: { Accept: 'application/json' } }, 8_000);
    if (!response.ok) return { status: 'error', message: `SearXNG HTTP ${response.status}.` };
    const payload = await response.json() as { results?: unknown[] };
    return Array.isArray(payload.results) ? { status: 'healthy', message: `SearXNG متصل (${payload.results.length} نتيجة فحص).` } : { status: 'degraded', message: 'SearXNG استجاب لكن صيغة النتائج غير متوقعة.' };
  } catch (error) {
    return { status: error instanceof SearXNGError ? (error.code === 'TIMEOUT' ? 'error' : 'degraded') : 'error', message: error instanceof Error ? error.message : 'تعذر الاتصال بـSearXNG.' };
  }
}

export function createSearXNGConnector(): LeadSourceConnector {
  return {
    key: 'searxng_search',
    async search(query: string, _spec: SearchSpecification, credentials: SourceCredentials): Promise<RawCandidate[]> {
      const results = await searxngSearch(query, credentials);
      return results.map((item) => ({
        source_url: item.url ?? null,
        evidence: item.content ?? '',
        _search_title: item.title ?? '',
        _search_engine: item.engine ?? '',
        _published_date: item.publishedDate ?? null,
        _search_query: query,
      }));
    },
    async fetchPublicPage(url: string): Promise<{ text: string; finalUrl: string } | null> { return fetchPublicPage(url); },
    async normalize(record: RawCandidate): Promise<LeadRecord> { return { source_url: record.source_url, notes: record.evidence }; },
    async validate(): Promise<{ valid: boolean; errors: string[] }> { return { valid: false, errors: ['تحتاج نتيجة SearXNG إلى استخراج AI قبل الاعتماد.'] }; },
  };
}
