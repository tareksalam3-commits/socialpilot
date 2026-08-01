export type Workspace = {
  id: string;
  name: string;
  logo_url: string | null;
  brand_name: string | null;
  timezone: string;
  language: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceMember = {
  id: string;
  workspace_id: string;
  user_id: string;
  role: string;
  created_at: string;
};

export type Profile = {
  id: string;
  user_id: string;
  avatar_url: string | null;
  full_name: string | null;
  theme: 'light' | 'dark' | 'system';
  language: string;
  created_at: string;
  updated_at: string;
};

export type ConnectedAccount = {
  id: string;
  workspace_id: string;
  platform: string;
  handle: string | null;
  status: 'connected' | 'disconnected' | 'error';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ScheduledPost = {
  id: string;
  workspace_id: string;
  content: string | null;
  status: 'draft' | 'scheduled' | 'published' | 'failed';
  scheduled_for: string | null;
  platforms: string[];
  created_at: string;
  updated_at: string;
};

export type AiUsage = {
  id: string;
  workspace_id: string;
  credits_used: number;
  credits_limit: number;
  period_start: string;
  updated_at: string;
};

export type Activity = {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ApiKey = {
  id: string;
  workspace_id: string;
  label: string;
  masked_value: string;
  status: 'active' | 'revoked';
  last_used_at: string | null;
  created_at: string;
};

export type AuthUser = {
  id: string;
  email: string;
};
