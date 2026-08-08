export type ChatRole = 'user' | 'assistant' | 'system';

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type BrandVoice = {
  id: string;
  workspace_id: string;
  business_name: string | null;
  description: string | null;
  audience: string | null;
  industry: string | null;
  writing_style: string | null;
  tone: string | null;
  keywords: string[];
  negative_keywords: string[];
  cta_style: string | null;
  emoji_style: string;
  created_at: string;
  updated_at: string;
};

// Platform-wide config (a single global row) — not per-workspace.
export type AiSettings = {
  model_selection: 'auto' | 'manual';
  provider: string;
  default_model: string;
  temperature: number;
  max_tokens: number;
  streaming: boolean;
  free_only_mode: boolean;
  mode: 'free' | 'hybrid' | 'paid';
  last_successful_model: string | null;
  last_successful_provider: string | null;
  created_at: string;
  updated_at: string;
};

export type Conversation = {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  model: string | null;
  favorite: boolean;
  pinned: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: ChatRole;
  content: string;
  model: string | null;
  tokens: number;
  response_time_ms: number | null;
  cost_estimate: number;
  favorite: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type PromptFolder = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
};

export type Prompt = {
  id: string;
  workspace_id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  content: string;
  category: string;
  variables: string[];
  favorite: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AiHistoryEntry = {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  input: string;
  output: string | null;
  model: string | null;
  provider: string;
  tokens_in: number;
  tokens_out: number;
  cost_estimate: number;
  response_time_ms: number | null;
  status: 'success' | 'failed' | 'timeout';
  favorite: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AiUsageEvent = {
  id: string;
  workspace_id: string;
  user_id: string;
  model: string;
  provider: string;
  tokens_in: number;
  tokens_out: number;
  cost: number;
  status: 'success' | 'failed' | 'timeout';
  response_time_ms: number | null;
  prompt_type: string | null;
  created_at: string;
};

export type ModelInfo = {
  id: string;
  name: string;
  context_length?: number;
  is_free: boolean;
  pricing?: { prompt: string; completion: string };
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  response_time_ms: number;
};

export type AiProvider = 'openrouter' | 'groq' | 'cerebras' | 'nvidia' | 'mistral' | 'zai';

export type ProviderInfo = {
  id: AiProvider;
  label: string;
  default_model: string;
  supports_model_list: boolean;
};

export type ProviderStatus = {
  provider: AiProvider;
  configured: boolean;
  base_url: string | null;
  account_id: string | null;
  last_test_status: 'connected' | 'failed' | null;
  last_tested_at: string | null;
  updated_at: string | null;
};

export type ProviderDailyUsage = {
  provider: AiProvider;
  requests_today: number;
  failed_today: number;
};

export type AiAnalytics = {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  avgResponseTime: number;
  successRate: number;
  failureRate: number;
  byModel: { model: string; requests: number; tokens: number; cost: number }[];
  byPromptType: { type: string; requests: number; tokens: number }[];
};
