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
  engines?: string[];
  publishedDate?: string;
};

export type SearXNGSearchOptions = {
  query?: string;
  language?: string;
  page?: number;
  time_range?: string | null;
  categories?: string[];
  engines?: string[];
  safe_search?: number | boolean;
};

export type SearXNGCapabilities = {
  baseUrl: string | null;
  checkedAt: string;
  status: 'healthy' | 'degraded' | 'error' | 'not_configured';
  message: string;
  searchAvailable: boolean;
  jsonAvailable: boolean;
  categoriesKnown: boolean;
  categories: string[];
  enginesKnown: boolean;
  engines: string[];
  languagesKnown: boolean;
  languages: string[];
  timeRangeKnown: boolean;
};

export type SearXNGErrorCode = 'NOT_CONFIGURED' | 'SOURCE_ERROR' | 'RATE_LIMITED' | 'TIMEOUT' | 'NO_RESULTS' | 'PERMISSION_ERROR' | 'JSON_NOT_ENABLED';

export class SearXNGError extends Error {
  readonly code: SearXNGErrorCode;
  constructor(code: SearXNGErrorCode, message?: string) {
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

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>);
  return [];
}

export async function searxngSearch(query: string, credentials: SourceCredentials, options: SearXNGSearchOptions = {}): Promise<SearXNGResult[]> {
  const baseUrl = normalizeBaseUrl(credentials.baseUrl);
  if (!baseUrl) throw new SearXNGError('NOT_CONFIGURED', 'SEARXNG_BASE_URL is not configured.');
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set('q', options.query?.trim() || query);
  url.searchParams.set('format', 'json');
  if (options.language) url.searchParams.set('language', options.language);
  url.searchParams.set('pageno', String(Math.max(1, Number(options.page ?? 1))));
  if (options.time_range) url.searchParams.set('time_range', options.time_range);
  if (options.categories?.length) url.searchParams.set('categories', options.categories.join(','));
  if (options.engines?.length) url.searchParams.set('engines', options.engines.join(','));
  if (options.safe_search !== undefined) url.searchParams.set('safesearch', String(options.safe_search === true ? 1 : options.safe_search === false ? 0 : options.safe_search));
  const response = await fetchWithRetry(url.toString(), { headers: { Accept: 'application/json' } });
  if (response.status === 401 || response.status === 403) throw new SearXNGError('PERMISSION_ERROR', `SearXNG HTTP ${response.status}.`);
  if (!response.ok) throw new SearXNGError('SOURCE_ERROR', `SearXNG HTTP ${response.status}.`);
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new SearXNGError('JSON_NOT_ENABLED', 'SearXNG لم يرجع JSON؛ فعّل JSON API في الـinstance.'); }
  const results = (payload as { results?: SearXNGResult[] } | null)?.results;
  if (!Array.isArray(results)) throw new SearXNGError('JSON_NOT_ENABLED', 'SearXNG JSON لا يحتوي على results array.');
  return results;
}

export async function discoverSearXNGCapabilities(baseUrlValue: string | null | undefined): Promise<SearXNGCapabilities> {
  const baseUrl = normalizeBaseUrl(baseUrlValue);
  const checkedAt = new Date().toISOString();
  const base: SearXNGCapabilities = {
    baseUrl, checkedAt, status: 'not_configured', message: 'لم يتم ضبط عنوان SearXNG.',
    searchAvailable: false, jsonAvailable: false,
    categoriesKnown: false, categories: [], enginesKnown: false, engines: [],
    languagesKnown: false, languages: [], timeRangeKnown: false,
  };
  if (!baseUrl) return base;

  try {
    const probeUrl = new URL(`${baseUrl}/search`);
    probeUrl.searchParams.set('q', 'SocialPilot Lead Hunter capability probe');
    probeUrl.searchParams.set('format', 'json');
    probeUrl.searchParams.set('pageno', '1');
    const response = await fetchWithRetry(probeUrl.toString(), { headers: { Accept: 'application/json' } }, 8_000);
    if (response.status === 401 || response.status === 403) return { ...base, status: 'error', message: `PERMISSION_ERROR: SearXNG HTTP ${response.status}.` };
    if (!response.ok) return { ...base, status: 'error', message: `SearXNG HTTP ${response.status}.` };
    let payload: Record<string, unknown>;
    try { payload = await response.json() as Record<string, unknown>; } catch { return { ...base, status: 'degraded', searchAvailable: true, message: 'JSON_NOT_ENABLED: فعّل JSON API في الـinstance.' }; }
    if (!Array.isArray(payload.results)) return { ...base, status: 'degraded', searchAvailable: true, message: 'JSON_NOT_ENABLED: لا توجد results array.' };

    const discovered: Partial<SearXNGCapabilities> = { searchAvailable: true, jsonAvailable: true, status: 'healthy', message: `SearXNG متصل (${payload.results.length} نتيجة فحص).` };
    const enginesFromResults = Array.from(new Set((payload.results as SearXNGResult[]).flatMap((item) => item.engines ?? (item.engine ? [item.engine] : []))));
    if (enginesFromResults.length) Object.assign(discovered, { enginesKnown: true, engines: enginesFromResults });

    try {
      const configResponse = await fetchWithRetry(`${baseUrl}/config`, { headers: { Accept: 'application/json' } }, 5_000);
      if (configResponse.ok) {
        const config = await configResponse.json() as Record<string, unknown>;
        const categories = stringList(config.categories ?? (config.search as Record<string, unknown> | undefined)?.categories);
        const engines = stringList(config.engines ?? (config.search as Record<string, unknown> | undefined)?.engines);
        const languages = stringList(config.languages ?? (config.search as Record<string, unknown> | undefined)?.languages);
        if (categories.length) Object.assign(discovered, { categoriesKnown: true, categories });
        if (engines.length) Object.assign(discovered, { enginesKnown: true, engines });
        if (languages.length) Object.assign(discovered, { languagesKnown: true, languages });
        if (typeof config.time_range === 'boolean') Object.assign(discovered, { timeRangeKnown: config.time_range });
      }
    } catch { /* unknown capability is intentionally not treated as available */ }
    return { ...base, ...discovered };
  } catch (error) {
    const code = error instanceof SearXNGError ? error.code : 'SOURCE_ERROR';
    return { ...base, status: code === 'TIMEOUT' ? 'error' : 'degraded', message: `${code}: ${error instanceof Error ? error.message : 'تعذر الاتصال بـSearXNG.'}` };
  }
}

export async function fetchPublicPage(url: string, maxChars = MAX_PAGE_CHARS): Promise<{ text: string; finalUrl: string } | null> {
  try {
    const response = await fetchWithRetry(url, { redirect: 'follow', headers: { Accept: 'text/html,text/plain;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; SocialPilotLeadHunter/1.0)' } });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) return null;
    const html = await response.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
    return { text: text.slice(0, maxChars), finalUrl: response.url || url };
  } catch { return null; }
}

export function createSearXNGConnector(): LeadSourceConnector {
  return {
    key: 'searxng_search',
    async search(query: string, _spec: SearchSpecification, credentials: SourceCredentials, options?: SearXNGSearchOptions): Promise<RawCandidate[]> {
      const results = await searxngSearch(query, credentials, options);
      return results.map((item) => ({ ...(item.url ? { source_url: item.url } : {}), evidence: item.content ?? '', _search_title: item.title ?? '', _search_engine: item.engine ?? item.engines?.join(',') ?? '', _published_date: item.publishedDate ?? null, _search_query: query, _search_options: options ?? {} }));
    },
    async fetchPublicPage(url: string): Promise<{ text: string; finalUrl: string } | null> { return fetchPublicPage(url); },
    async normalize(record: RawCandidate): Promise<LeadRecord> { return { source_url: record.source_url, notes: record.evidence }; },
    async validate(): Promise<{ valid: boolean; errors: string[] }> { return { valid: false, errors: ['تحتاج نتيجة SearXNG إلى استخراج AI قبل الاعتماد.'] }; },
  };
}
