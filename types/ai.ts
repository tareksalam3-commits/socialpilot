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
  // Brand DNA fields — Phase 2, STEP 3. Added alongside the original
  // columns above rather than in a separate table (see brandVoiceRepository
  // and the 20260810120000_brand_dna.sql migration).
  formality: string | null;
  voice: string | null;
  sentence_style: string | null;
  hook_style: string | null;
  hashtag_policy: string | null;
  content_length: string | null;
  brand_values: string[];
  audience_relationship: string | null;
  created_at: string;
  updated_at: string;
};

export type AwarenessLevel = 'unaware' | 'problem_aware' | 'solution_aware' | 'product_aware' | 'most_aware';
export type PurchaseIntent = 'low' | 'medium' | 'high';

/** Structured, persistent Audience Intelligence — Phase 2, STEP 4. One row
 * per workspace (seeded automatically on workspace creation, same pattern
 * as BrandVoice), distinct from the assistant pipeline's per-post
 * audienceAgent inference: this is the workspace-level persona that
 * informs every AI task, not a single request's suggestion. */
export type AudienceProfile = {
  id: string;
  workspace_id: string;
  persona: string | null;
  pain_points: string[];
  desires: string[];
  motivations: string[];
  objections: string[];
  awareness_level: AwarenessLevel | null;
  interests: string[];
  preferred_content: string[];
  language_style: string | null;
  purchase_intent: PurchaseIntent | null;
  /** Managed only by the background Audience Intelligence worker. */
  inference_status: 'idle' | 'queued' | 'analyzing' | 'ready' | 'failed' | 'needs_brand_context';
  inference_sources: {
    source?: string;
    brand_fields?: string[];
    active_learning_count?: number;
    active_pattern_count?: number;
    learning_ids?: string[];
    generated_at?: string;
  };
  inference_error: string | null;
  inferred_at: string | null;
  learning_refreshed_at: string | null;
  created_at: string;
  updated_at: string;
};

// Platform-wide config (a single global row) — not per-workspace.
export type AiSettings = {
  model_selection: 'auto' | 'manual';
  provider: string;
  default_model: string;
  // Dedicated model for the Quality Control stage — must always differ
  // from default_model (see qualityControl.ts / taskRouter.ts). null means
  // "auto-pick a different model at review time".
  qc_model: string | null;
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

export type AiProvider = 'openrouter' | 'groq' | 'cerebras' | 'nvidia' | 'mistral' | 'zai' | 'huggingface' | 'direct';

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
