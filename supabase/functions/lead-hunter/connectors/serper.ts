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
    async normalize(record: RawCandidate): Promise<LeadRecord> {
      return { source_url: record.source_url, notes: record.evidence };
    },
    async validate(): Promise<{ valid: boolean; errors: string[] }> {
      return { valid: false, errors: ['يتطلب استخراج AI قبل الاعتماد — لا يُستخدم هذا المسار للنتائج الخام.'] };
    },
  };
}
