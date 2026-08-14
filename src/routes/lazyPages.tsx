import { lazy, type ComponentType } from 'react';

/**
 * Every route-level page is declared here as a `{ Component, preload }` pair
 * instead of a bare `lazy()` call. `preload` is the same dynamic `import()`
 * promise factory, so calling it (e.g. on nav-link hover/focus) warms the
 * module cache ahead of the actual navigation — by the time the click lands,
 * the chunk is already fetched and React.lazy resolves instantly instead of
 * showing a loading fallback.
 */
function page<T extends Record<string, unknown>>(loader: () => Promise<T>, exportName: keyof T) {
  const Component = lazy(() => loader().then((m) => ({ default: m[exportName] as unknown as ComponentType })));
  return { Component, preload: loader };
}

export const pages = {
  login: page(() => import('@/features/auth/LoginPage'), 'LoginPage'),
  register: page(() => import('@/features/auth/RegisterPage'), 'RegisterPage'),
  forgotPassword: page(() => import('@/features/auth/ForgotPasswordPage'), 'ForgotPasswordPage'),
  resetPassword: page(() => import('@/features/auth/ResetPasswordPage'), 'ResetPasswordPage'),
  terms: page(() => import('@/features/legal/TermsOfServicePage'), 'TermsOfServicePage'),
  privacy: page(() => import('@/features/legal/PrivacyPolicyPage'), 'PrivacyPolicyPage'),
  dashboard: page(() => import('@/features/dashboard/DashboardPage'), 'DashboardPage'),
  assistant: page(() => import('@/features/assistant/AIAssistantPage'), 'AIAssistantPage'),
  settings: page(() => import('@/features/settings/SettingsPage'), 'SettingsPage'),
  accounts: page(() => import('@/features/accounts/ConnectedAccountsPage'), 'ConnectedAccountsPage'),
  posts: page(() => import('@/features/content/ContentWorkspacePage'), 'ContentWorkspacePage'),
  automation: page(() => import('@/features/automation/AutomationPage'), 'AutomationPage'),
  media: page(() => import('@/features/media/MediaLibraryPage'), 'MediaLibraryPage'),
  inbox: page(() => import('@/features/inbox/InboxPage'), 'InboxPage'),
  notifications: page(() => import('@/features/notifications/NotificationsPage'), 'NotificationsPage'),
  analytics: page(() => import('@/features/analytics/AnalyticsPage'), 'AnalyticsPage'),
  contentInsights: page(() => import('@/features/analytics/ContentInsightsPage'), 'ContentInsightsPage'),
  search: page(() => import('@/features/search/GlobalSearchPage'), 'GlobalSearchPage'),
  workspace: page(() => import('@/features/workspace/WorkspacePage'), 'WorkspacePage'),
  playground: page(() => import('@/features/content/ContentWorkspacePage'), 'ContentWorkspacePage'),
  studio: page(() => import('@/features/ai/ContentStudioPage'), 'ContentStudioPage'),
  prompts: page(() => import('@/features/ai/PromptLibraryPage'), 'PromptLibraryPage'),
  aiHistory: page(() => import('@/features/ai/AIHistoryPage'), 'AIHistoryPage'),
  brandVoice: page(() => import('@/features/ai/BrandVoicePage'), 'BrandVoicePage'),
  contentSources: page(() => import('@/features/contentSources/ContentSourcesPage'), 'ContentSourcesPage'),
  // Super Admin panel (/admin/*) — separate from the workspace app pages above.
  adminDashboard: page(() => import('@/features/admin/AdminDashboardPage'), 'AdminDashboardPage'),
  adminUsers: page(() => import('@/features/admin/AllUsersPage'), 'AllUsersPage'),
  adminWorkspaces: page(() => import('@/features/admin/AllWorkspacesPage'), 'AllWorkspacesPage'),
  adminSubscriptions: page(() => import('@/features/admin/SubscriptionsPage'), 'SubscriptionsPage'),
  adminPlans: page(() => import('@/features/admin/SubscriptionPlansPage'), 'SubscriptionPlansPage'),
  adminPayments: page(() => import('@/features/admin/PaymentsPage'), 'PaymentsPage'),
  adminAiCredits: page(() => import('@/features/admin/AiCreditsPage'), 'AiCreditsPage'),
  adminAiProviders: page(() => import('@/features/admin/AiProvidersPage'), 'AiProvidersPage'),
  adminIntegrations: page(() => import('@/features/admin/AdminIntegrationsPage'), 'AdminIntegrationsPage'),
  adminSettings: page(() => import('@/features/admin/SystemSettingsPage'), 'SystemSettingsPage'),
  adminAuditLogs: page(() => import('@/features/admin/AuditLogsPage'), 'AuditLogsPage'),
  adminAnalytics: page(() => import('@/features/admin/AnalyticsPage'), 'AnalyticsPage'),
} as const;

/** Maps each `/app/*` route path to its preload function, for hover-prefetching from the sidebar. */
export const preloadByPath: Record<string, () => Promise<unknown>> = {
  '/app/assistant': pages.assistant.preload,
  '/app/dashboard': pages.dashboard.preload,
  '/app/analytics': pages.analytics.preload,
  '/app/insights': pages.contentInsights.preload,
  '/app/search': pages.search.preload,
  '/app/accounts': pages.accounts.preload,
  '/app/posts': pages.posts.preload,
  '/app/media': pages.media.preload,
  '/app/inbox': pages.inbox.preload,
  '/app/automation': pages.automation.preload,
  '/app/playground': pages.playground.preload,
  '/app/studio': pages.studio.preload,
  '/app/prompts': pages.prompts.preload,
  '/app/ai-history': pages.aiHistory.preload,
  '/app/workspace': pages.workspace.preload,
  '/app/notifications': pages.notifications.preload,
  '/app/brand-voice': pages.brandVoice.preload,
  '/app/audience': pages.brandVoice.preload,
  '/app/content-sources': pages.contentSources.preload,
  '/app/settings': pages.settings.preload,
};

let warmed = false;
/** Fires once per session, shortly after first paint, to prefetch the most-used pages. */
export function warmCommonPages() {
  if (warmed) return;
  warmed = true;
  pages.assistant.preload().catch(() => {});
  pages.dashboard.preload().catch(() => {});
  pages.posts.preload().catch(() => {});
  pages.analytics.preload().catch(() => {});
}
