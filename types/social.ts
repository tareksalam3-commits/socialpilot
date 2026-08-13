export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'archived';

export type Post = {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string | null;
  content: string;
  status: PostStatus;
  platforms: string[];
  media_urls: string[];
  scheduled_for: string | null;
  published_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PostPlatformTarget = {
  id: string;
  post_id: string;
  platform: string;
  account_id: string | null;
  external_id: string | null;
  status: 'pending' | 'publishing' | 'published' | 'failed';
  error_message: string | null;
  published_content: string | null;
  published_at: string | null;
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type PublishingLog = {
  id: string;
  workspace_id: string;
  post_id: string | null;
  target_id: string | null;
  platform: string | null;
  event: 'queued' | 'attempt' | 'success' | 'failure' | 'retry_scheduled' | 'gave_up';
  message: string | null;
  created_at: string;
};

export type SchedulerStatus = {
  job_name: string;
  schedule: string;
  active: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_return_message: string | null;
};

export type MediaFolder = {
  id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  created_at: string;
};

export type MediaItem = {
  id: string;
  workspace_id: string;
  user_id: string;
  folder_id: string | null;
  name: string;
  type: 'image' | 'video' | 'document';
  url: string;
  thumbnail_url: string | null;
  size_bytes: number | null;
  mime_type: string | null;
  tags: string[];
  compression_status: 'none' | 'pending' | 'compressed' | 'optimized';
  metadata: Record<string, unknown>;
  created_at: string;
};

export type InboxConversation = {
  id: string;
  workspace_id: string;
  account_id: string | null;
  platform: string;
  external_id: string | null;
  external_participant_id: string | null;
  type: 'comment' | 'dm';
  sender_name: string | null;
  sender_avatar: string | null;
  snippet: string | null;
  unread: boolean;
  archived: boolean;
  needs_review: boolean;
  assigned_to: string | null;
  metadata: Record<string, unknown> & { ai_draft?: string };
  created_at: string;
  updated_at: string;
};

export type InboxAutomationRule = {
  id: string;
  workspace_id: string;
  account_id: string | null;
  created_by: string | null;
  enabled: boolean;
  scope: ('dm' | 'comment')[];
  mode: 'auto_send' | 'draft_only';
  tone_override: string | null;
  business_hours_only: boolean;
  excluded_keywords: string[];
  max_auto_replies_per_day: number;
  created_at: string;
  updated_at: string;
};

export type InboxMessage = {
  id: string;
  conversation_id: string;
  user_id: string | null;
  direction: 'inbound' | 'outbound';
  content: string;
  is_ai: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type Notification = {
  id: string;
  workspace_id: string;
  user_id: string;
  type: 'publishing_success' | 'publishing_failure' | 'ai_event' | 'account_event' | 'workspace_event' | 'security_alert';
  title: string;
  message: string | null;
  read: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type WorkspaceInvitation = {
  id: string;
  workspace_id: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked';
  invited_by: string;
  token: string;
  created_at: string;
  expires_at: string;
};

export type PostAnalytics = {
  id: string;
  post_id: string;
  workspace_id: string;
  platform: string;
  reach: number;
  impressions: number;
  engagement: number;
  clicks: number;
  likes: number;
  comments: number;
  shares: number;
  recorded_at: string;
};

export type AccountAnalytics = {
  id: string;
  workspace_id: string;
  account_id: string;
  platform: string;
  followers: number;
  followers_delta: number;
  reach: number;
  impressions: number;
  engagement: number;
  clicks: number;
  recorded_at: string;
};

export type ExtendedConnectedAccount = {
  id: string;
  workspace_id: string;
  platform: string;
  handle: string | null;
  status: 'connected' | 'disconnected' | 'error';
  metadata: Record<string, unknown>;
  provider_account_id: string | null;
  permissions: string[];
  sync_status: 'idle' | 'syncing' | 'synced' | 'error';
  last_synced_at: string | null;
  health_status: 'healthy' | 'warning' | 'error' | 'unknown';
  token_expires_at: string | null;
  created_at: string;
  updated_at: string;
};
