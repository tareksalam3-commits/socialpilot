// Cost Controller — the only module that writes to ai_usage_events / updates
// last_successful_model. It also estimates request cost where pricing data
// is actually available, so the usage table carries a real number instead of
// a placeholder wherever possible.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import type { ModelInfo } from './modelRegistry.ts';

export type UsageEvent = {
  model: string;
  provider: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  status: string;
  response_time_ms: number;
  prompt_type: string;
};

export async function recordUsage(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  userId: string,
  event: UsageEvent,
): Promise<void> {
  await supabase.from('ai_usage_events').insert({
    workspace_id: workspaceId,
    user_id: userId,
    model: event.model,
    provider: event.provider,
    tokens_in: event.tokens_in,
    tokens_out: event.tokens_out,
    cost: event.cost,
    status: event.status,
    response_time_ms: event.response_time_ms,
    prompt_type: event.prompt_type,
  });
}

export async function updateLastSuccessful(
  supabase: ReturnType<typeof createClient>,
  provider: string,
  model: string,
): Promise<void> {
  await supabase
    .from('ai_settings')
    .update({ last_successful_model: model, last_successful_provider: provider, updated_at: new Date().toISOString() })
    .eq('id', true);
}

// Only OpenRouter's /models response exposes per-token pricing today, so a
// real dollar estimate is only possible for that provider — everywhere else
// stays 0 (matching the existing behavior) rather than guessing at a number
// we can't source. If a wider pricing table gets added to the registry
// later, this is the one place that needs to change.
export function estimateCost(modelId: string, tokensIn: number, tokensOut: number, models: ModelInfo[] | null): number {
  if (!models) return 0;
  const model = models.find((m) => m.id === modelId);
  if (!model?.pricing) return 0;
  const promptRate = parseFloat(model.pricing.prompt);
  const completionRate = parseFloat(model.pricing.completion);
  if (Number.isNaN(promptRate) || Number.isNaN(completionRate)) return 0;
  return tokensIn * promptRate + tokensOut * completionRate;
}
