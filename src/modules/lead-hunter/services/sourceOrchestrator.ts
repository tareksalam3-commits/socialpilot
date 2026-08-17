import type { LeadSearchQuery, LeadSource } from '../types';

export type RawLead = Record<string, unknown>;
export type NormalizedLead = RawLead & { sourceId: string; sourceUrl?: string };
export type ValidationResult = { valid: boolean; errors: string[] };
export type HealthStatus = { status: LeadSource['status']; message?: string };

export interface LeadSourceConnector {
  readonly key: string;
  search(query: LeadSearchQuery): Promise<RawLead[]>;
  normalize(record: RawLead): Promise<NormalizedLead>;
  validate(record: NormalizedLead): Promise<ValidationResult>;
  healthCheck(): Promise<HealthStatus>;
}

export type ConnectorRunStat = {
  source: string;
  status: string;
  error?: string;
  retry_count: number;
  records_found: number;
  timestamp: string;
  duration: number;
};

export class LeadSourceOrchestrator {
  constructor(private readonly connectors: Map<string, LeadSourceConnector>) {}

  async run(query: LeadSearchQuery, sources: LeadSource[]): Promise<{ records: NormalizedLead[]; stats: ConnectorRunStat[] }> {
    const records: NormalizedLead[] = [];
    const stats: ConnectorRunStat[] = [];
    const ordered = sources.filter((source) => source.enabled).sort((a, b) => a.priority - b.priority);

    for (const source of ordered) {
      const started = Date.now();
      const connector = this.connectors.get(source.connector_key);
      if (!connector) {
        stats.push({
          source: source.connector_key,
          status: 'not_configured',
          error: 'المصدر غير مهيأ لهذا النوع من البيانات.',
          retry_count: 0,
          records_found: 0,
          timestamp: new Date().toISOString(),
          duration: Date.now() - started,
        });
        continue;
      }
      try {
        const rawRecords = await connector.search(query);
        for (const raw of rawRecords) {
          const normalized = await connector.normalize(raw);
          const validation = await connector.validate(normalized);
          if (validation.valid) records.push(normalized);
        }
        stats.push({ source: source.connector_key, status: 'healthy', retry_count: 0, records_found: rawRecords.length, timestamp: new Date().toISOString(), duration: Date.now() - started });
      } catch (error) {
        stats.push({ source: source.connector_key, status: 'error', error: error instanceof Error ? error.message : 'تعذر الوصول إلى المصدر.', retry_count: 0, records_found: 0, timestamp: new Date().toISOString(), duration: Date.now() - started });
      }
    }
    return { records, stats };
  }
}
