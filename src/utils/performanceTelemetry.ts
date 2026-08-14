export type PerformanceKind = 'ai_call' | 'database' | 'improvement' | 'pipeline';

export type PerformanceEvent = {
  kind: PerformanceKind;
  name: string;
  durationMs: number;
  success: boolean;
  attempt?: number;
  model?: string;
  metadata?: Record<string, unknown>;
  at: string;
};

const MAX_EVENTS = 250;
const events: PerformanceEvent[] = [];

function emit(event: PerformanceEvent): void {
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('socialpilot:performance', { detail: event }));
  }
  if (import.meta.env.DEV) console.debug('[SocialPilot performance]', event);
}

export function recordPerformance(event: Omit<PerformanceEvent, 'at'>): void {
  emit({ ...event, at: new Date().toISOString() });
}

export async function measurePerformance<T>(
  kind: PerformanceKind,
  name: string,
  operation: () => Promise<T>,
  metadata?: Record<string, unknown>,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await operation();
    recordPerformance({ kind, name, durationMs: Math.round(performance.now() - started), success: true, metadata });
    return result;
  } catch (error) {
    recordPerformance({
      kind,
      name,
      durationMs: Math.round(performance.now() - started),
      success: false,
      metadata: { ...metadata, error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

export function getPerformanceSnapshot(): PerformanceEvent[] {
  return events.slice();
}

export function clearPerformanceSnapshot(): void {
  events.length = 0;
}

export function getPerformanceSummary(): {
  events: PerformanceEvent[];
  aiCalls: number;
  aiDurationMs: number;
  databaseOperations: number;
  databaseDurationMs: number;
  improvements: number;
  improvementDurationMs: number;
} {
  const snapshot = getPerformanceSnapshot();
  return {
    events: snapshot,
    aiCalls: snapshot.filter((event) => event.kind === 'ai_call').length,
    aiDurationMs: snapshot.filter((event) => event.kind === 'ai_call').reduce((sum, event) => sum + event.durationMs, 0),
    databaseOperations: snapshot.filter((event) => event.kind === 'database').length,
    databaseDurationMs: snapshot.filter((event) => event.kind === 'database').reduce((sum, event) => sum + event.durationMs, 0),
    improvements: snapshot.filter((event) => event.kind === 'improvement').length,
    improvementDurationMs: snapshot.filter((event) => event.kind === 'improvement').reduce((sum, event) => sum + event.durationMs, 0),
  };
}

export const AI_CALL_TIMEOUT_MS = 90_000;

export function isRetryableProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /timeout|timed out|429|502|503|504|network|fetch failed|temporar/.test(message);
}
