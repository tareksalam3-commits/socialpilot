export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  plan: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
};

export type BrandDna = {
  id: string;
  workspace_id: string;
  status: 'draft' | 'confirmed';
  basics: Record<string, unknown>;
  identity: Record<string, unknown>;
  tone: Record<string, unknown>;
  audience: Record<string, unknown>;
  content: Record<string, unknown>;
  visual: Record<string, unknown>;
  platforms: string[];
  created_at: string;
  updated_at: string;
};

export type BrandMemoryEntry = {
  id: string;
  workspace_id: string;
  type: 'preference' | 'performance' | 'decision' | 'rejection' | 'approval' | 'edit_pattern';
  key: string;
  value: string;
  confidence: number;
  evidence_count: number;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialPlatform =
  | 'facebook' | 'instagram' | 'linkedin' | 'x'
  | 'threads' | 'tiktok' | 'telegram' | 'whatsapp';

export type SocialAccount = {
  id: string;
  workspace_id: string;
  platform: SocialPlatform;
  handle: string | null;
  display_name: string | null;
  status: 'connected' | 'disconnected' | 'error' | 'expired';
  needs_reconnect: boolean;
  metadata: Record<string, unknown>;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ContentStatus =
  | 'idea' | 'draft' | 'review' | 'approved'
  | 'scheduled' | 'published' | 'rejected';

export type Content = {
  id: string;
  workspace_id: string;
  title: string;
  goal: string | null;
  topic: string | null;
  audience: string | null;
  master_text: string | null;
  status: ContentStatus;
  platforms: string[];
  ai_meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ContentVariant = {
  id: string;
  content_id: string;
  workspace_id: string;
  platform: string;
  text: string;
  hashtags: string[];
  cta: string | null;
  media_brief: Record<string, unknown>;
  status: 'draft' | 'review' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
};

export type QualityVerdict = 'pass' | 'review' | 'fail';

export type QualityReview = {
  id: string;
  variant_id: string;
  workspace_id: string;
  verdict: QualityVerdict;
  scores: Record<string, number>;
  reasons: string[];
  fixes_applied: number;
  created_at: string;
};

export type CalendarItem = {
  id: string;
  workspace_id: string;
  content_id: string | null;
  variant_id: string | null;
  platform: string;
  scheduled_for: string;
  status: 'planned' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
  created_at: string;
};

export type PublishingJob = {
  id: string;
  workspace_id: string;
  variant_id: string | null;
  calendar_item_id: string | null;
  idempotency_key: string;
  action: 'publish' | 'schedule' | 'retry';
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_for: string | null;
  completed_at: string | null;
  created_at: string;
};

export type AiRun = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  task: string;
  intent: string | null;
  agents: string[];
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  status: 'running' | 'succeeded' | 'failed';
  error: string | null;
  result: Record<string, unknown>;
  created_at: string;
};

export type Notification = {
  id: string;
  workspace_id: string;
  user_id: string | null;
  type: string;
  title: string;
  body: string | null;
  payload: Record<string, unknown>;
  read: boolean;
  created_at: string;
};

// ---- AI Gateway request/response shapes ----

export type AiIntent =
  | 'generate_brand_dna'
  | 'create_content'
  | 'create_content_plan'
  | 'analyze_performance'
  | 'suggest_ideas'
  | 'general_advice';

export type AiGatewayRequest = {
  intent: AiIntent;
  workspaceId: string;
  brandDnaId?: string;
  message: string;
  platforms?: string[];
  context?: Record<string, unknown>;
};

export type GeneratedBrandDna = {
  identity: Record<string, unknown>;
  tone: Record<string, unknown>;
  audience: Record<string, unknown>;
  content: Record<string, unknown>;
  visual: Record<string, unknown>;
  platforms: string[];
  summary: string;
};

export type GeneratedVariant = {
  platform: string;
  text: string;
  hashtags: string[];
  cta: string;
  media_brief: Record<string, unknown>;
};

export type GeneratedContent = {
  title: string;
  goal: string;
  topic: string;
  audience: string;
  master_text: string;
  platforms: string[];
  variants: GeneratedVariant[];
};

export type QualityAnalysis = {
  verdict: QualityVerdict;
  scores: Record<string, number>;
  reasons: string[];
};

export type CalendarSlot = {
  date: string;
  platform: string;
  title: string;
};

export type ContentPlan = {
  theme: string;
  slots: CalendarSlot[];
};

export type AiGatewayResponse = {
  runId: string;
  agents: string[];
  model: string;
  provider: string;
  latencyMs: number;
  result: GeneratedBrandDna | GeneratedContent | ContentPlan | { advice: string };
};
