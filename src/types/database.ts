export type Workspace = {
  id: string;
  name: string;
  logo_url: string | null;
  brand_name: string | null;
  timezone: string;
  language: string;
  owner_id: string;
  auto_publish_enabled: boolean;
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

export type PlatformRole = 'user' | 'super_admin';

/** Workspace-scoped role, stored on `workspace_members.role`. */
export type WorkspaceRole = 'owner' | 'manager' | 'member';

export type Profile = {
  id: string;
  user_id: string;
  avatar_url: string | null;
  full_name: string | null;
  theme: 'light' | 'dark' | 'system';
  language: string;
  /** Platform-wide role, independent of any workspace. Only 'super_admin'
   * unlocks the /admin panel — everyone else is a regular 'user'. */
  platform_role: PlatformRole;
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

// ============================================================
// Super Admin platform types
// ============================================================

export type SubscriptionPlan = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  ai_credits_included: number;
  max_workspaces: number;
  max_seats: number;
  max_connected_accounts: number;
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled' | 'suspended';

export type Subscription = {
  id: string;
  workspace_id: string;
  plan_id: string | null;
  status: SubscriptionStatus;
  billing_cycle: 'monthly' | 'yearly';
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
};

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';

export type Payment = {
  id: string;
  workspace_id: string;
  subscription_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  provider: string;
  provider_reference: string | null;
  invoice_url: string | null;
  paid_at: string | null;
  created_at: string;
};

export type AiProviderRow = {
  id: string;
  name: string;
  display_name: string;
  base_url: string | null;
  is_active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
};

export type AiModelRow = {
  id: string;
  provider_id: string;
  model_key: string;
  display_name: string;
  context_window: number;
  cost_per_1k_input: number;
  cost_per_1k_output: number;
  is_free: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SystemSetting = {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type AuditLog = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

/** Row shape returned by the `admin-users` edge function — profile data
 * joined with auth.users (email, last sign-in) which regular clients can't
 * read directly. */
export type AdminUserRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  platform_role: PlatformRole;
  created_at: string;
  last_sign_in_at: string | null;
  banned: boolean;
  workspaces: { id: string; name: string; role: WorkspaceRole }[];
};
