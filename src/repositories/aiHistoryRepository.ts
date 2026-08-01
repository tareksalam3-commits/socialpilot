import { supabase } from '@/services/supabase';
import { escapePostgrestFilterValue } from '@/utils/postgrestFilter';
import type { AiHistoryEntry, AiUsageEvent, AiAnalytics } from '@/types/ai';

export const aiHistoryRepository = {
  async list(userId: string, limit = 50): Promise<AiHistoryEntry[]> {
    const { data, error } = await supabase
      .from('ai_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as AiHistoryEntry[];
  },

  async search(userId: string, query: string): Promise<AiHistoryEntry[]> {
    const safe = escapePostgrestFilterValue(query);
    const { data, error } = await supabase
      .from('ai_history')
      .select('*')
      .eq('user_id', userId)
      .or(`input.ilike.%${safe}%,output.ilike.%${safe}%,type.ilike.%${safe}%`)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as AiHistoryEntry[];
  },

  async create(input: {
    workspace_id: string;
    type: string;
    input: string;
    output: string | null;
    model: string | null;
    provider?: string;
    tokens_in?: number;
    tokens_out?: number;
    cost_estimate?: number;
    response_time_ms?: number;
    status?: 'success' | 'failed' | 'timeout';
    metadata?: Record<string, unknown>;
  }): Promise<AiHistoryEntry> {
    const { data, error } = await supabase
      .from('ai_history')
      .insert({
        workspace_id: input.workspace_id,
        type: input.type,
        input: input.input,
        output: input.output,
        model: input.model,
        provider: input.provider ?? 'openrouter',
        tokens_in: input.tokens_in ?? 0,
        tokens_out: input.tokens_out ?? 0,
        cost_estimate: input.cost_estimate ?? 0,
        response_time_ms: input.response_time_ms ?? null,
        status: input.status ?? 'success',
        metadata: input.metadata ?? {},
      })
      .select()
      .single();
    if (error) throw error;
    return data as AiHistoryEntry;
  },

  async update(id: string, patch: Partial<AiHistoryEntry>): Promise<void> {
    const { error } = await supabase.from('ai_history').update(patch).eq('id', id);
    if (error) throw error;
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('ai_history').delete().eq('id', id);
    if (error) throw error;
  },

  async toggleFavorite(id: string, favorite: boolean): Promise<void> {
    const { error } = await supabase.from('ai_history').update({ favorite }).eq('id', id);
    if (error) throw error;
  },
};

export const aiAnalyticsRepository = {
  async getEvents(userId: string, days = 30): Promise<AiUsageEvent[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const { data, error } = await supabase
      .from('ai_usage_events')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as AiUsageEvent[];
  },

  computeAnalytics(events: AiUsageEvent[]): AiAnalytics {
    const total = events.length;
    const successes = events.filter((e) => e.status === 'success');
    const failures = events.filter((e) => e.status !== 'success');
    const totalTokensIn = events.reduce((sum, e) => sum + e.tokens_in, 0);
    const totalTokensOut = events.reduce((sum, e) => sum + e.tokens_out, 0);
    const totalCost = events.reduce((sum, e) => sum + e.cost, 0);
    const responseTimes = successes.filter((e) => e.response_time_ms).map((e) => e.response_time_ms!);
    const avgResponseTime = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;

    const modelMap = new Map<string, { requests: number; tokens: number; cost: number }>();
    const typeMap = new Map<string, { requests: number; tokens: number }>();
    for (const e of events) {
      const m = modelMap.get(e.model) ?? { requests: 0, tokens: 0, cost: 0 };
      m.requests += 1;
      m.tokens += e.tokens_in + e.tokens_out;
      m.cost += e.cost;
      modelMap.set(e.model, m);

      const t = typeMap.get(e.prompt_type ?? 'unknown') ?? { requests: 0, tokens: 0 };
      t.requests += 1;
      t.tokens += e.tokens_in + e.tokens_out;
      typeMap.set(e.prompt_type ?? 'unknown', t);
    }

    return {
      totalRequests: total,
      totalTokensIn,
      totalTokensOut,
      totalCost,
      avgResponseTime,
      successRate: total > 0 ? Math.round((successes.length / total) * 100) : 0,
      failureRate: total > 0 ? Math.round((failures.length / total) * 100) : 0,
      byModel: Array.from(modelMap.entries())
        .map(([model, v]) => ({ model, ...v }))
        .sort((a, b) => b.requests - a.requests),
      byPromptType: Array.from(typeMap.entries())
        .map(([type, v]) => ({ type, ...v }))
        .sort((a, b) => b.requests - a.requests),
    };
  },
};
