import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/providers/AuthProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { LanguageProvider } from '@/providers/LanguageProvider';
import { ToastProvider } from '@/providers/ToastProvider';
import { ProtectedRoute } from '@/layouts/ProtectedRoute';
import { AppLayout } from '@/layouts/AppLayout';
import { LoadingScreen } from '@/ui';
import { CommandBar } from '@/features/ai/CommandBar';

const LoginPage = lazy(() => import('@/features/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@/features/auth/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('@/features/auth/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ConnectedAccountsPage = lazy(() => import('@/features/accounts/ConnectedAccountsPage').then((m) => ({ default: m.ConnectedAccountsPage })));
const ScheduledPostsPage = lazy(() => import('@/features/posts/ScheduledPostsPage').then((m) => ({ default: m.ScheduledPostsPage })));
const AutomationPage = lazy(() => import('@/features/automation/AutomationPage').then((m) => ({ default: m.AutomationPage })));
const ContentCalendarPage = lazy(() => import('@/features/posts/ContentCalendarPage').then((m) => ({ default: m.ContentCalendarPage })));
const MediaLibraryPage = lazy(() => import('@/features/media/MediaLibraryPage').then((m) => ({ default: m.MediaLibraryPage })));
const InboxPage = lazy(() => import('@/features/inbox/InboxPage').then((m) => ({ default: m.InboxPage })));
const NotificationsPage = lazy(() => import('@/features/notifications/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const AnalyticsPage = lazy(() => import('@/features/analytics/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const GlobalSearchPage = lazy(() => import('@/features/search/GlobalSearchPage').then((m) => ({ default: m.GlobalSearchPage })));
const WorkspacePage = lazy(() => import('@/features/workspace/WorkspacePage').then((m) => ({ default: m.WorkspacePage })));
const AudiencePage = lazy(() => import('@/features/audience/AudiencePage').then((m) => ({ default: m.AudiencePage })));
const PlaygroundPage = lazy(() => import('@/features/ai/PlaygroundPage').then((m) => ({ default: m.PlaygroundPage })));
const ContentStudioPage = lazy(() => import('@/features/ai/ContentStudioPage').then((m) => ({ default: m.ContentStudioPage })));
const PromptLibraryPage = lazy(() => import('@/features/ai/PromptLibraryPage').then((m) => ({ default: m.PromptLibraryPage })));
const AIHistoryPage = lazy(() => import('@/features/ai/AIHistoryPage').then((m) => ({ default: m.AIHistoryPage })));
const TokenAnalyticsPage = lazy(() => import('@/features/ai/TokenAnalyticsPage').then((m) => ({ default: m.TokenAnalyticsPage })));
const AISettingsPage = lazy(() => import('@/features/ai/AISettingsPage').then((m) => ({ default: m.AISettingsPage })));
const BrandVoicePage = lazy(() => import('@/features/ai/BrandVoicePage').then((m) => ({ default: m.BrandVoicePage })));

function App() {
  return (
    <LanguageProvider>
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <CommandBar />
            <Suspense fallback={<LoadingScreen />}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route
                  path="/app"
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="/app/dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="accounts" element={<ConnectedAccountsPage />} />
                  <Route path="scheduled" element={<ScheduledPostsPage />} />
                  <Route path="automation" element={<AutomationPage />} />
                  <Route path="calendar" element={<ContentCalendarPage />} />
                  <Route path="media" element={<MediaLibraryPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="notifications" element={<NotificationsPage />} />
                  <Route path="analytics" element={<AnalyticsPage />} />
                  <Route path="search" element={<GlobalSearchPage />} />
                  <Route path="workspace" element={<WorkspacePage />} />
                  <Route path="audience" element={<AudiencePage />} />
                  <Route path="playground" element={<PlaygroundPage />} />
                  <Route path="studio" element={<ContentStudioPage />} />
                  <Route path="prompts" element={<PromptLibraryPage />} />
                  <Route path="ai-history" element={<AIHistoryPage />} />
                  <Route path="token-analytics" element={<TokenAnalyticsPage />} />
                  <Route path="ai-settings" element={<AISettingsPage />} />
                  <Route path="brand-voice" element={<BrandVoicePage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
                <Route path="/" element={<Navigate to="/app/dashboard" replace />} />
                <Route path="*" element={<Navigate to="/app/dashboard" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
    </LanguageProvider>
  );
}

export default App;
