import { Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/providers/AuthProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { LanguageProvider } from '@/providers/LanguageProvider';
import { ToastProvider } from '@/providers/ToastProvider';
import { ProtectedRoute } from '@/layouts/ProtectedRoute';
import { AppLayout } from '@/layouts/AppLayout';
import { LoadingScreen } from '@/ui';
import { CommandBar } from '@/features/ai/CommandBar';
import { pages, warmCommonPages } from '@/routes/lazyPages';

const {
  login: { Component: LoginPage },
  register: { Component: RegisterPage },
  forgotPassword: { Component: ForgotPasswordPage },
  resetPassword: { Component: ResetPasswordPage },
  dashboard: { Component: DashboardPage },
  assistant: { Component: AIAssistantPage },
  settings: { Component: SettingsPage },
  accounts: { Component: ConnectedAccountsPage },
  scheduled: { Component: ScheduledPostsPage },
  automation: { Component: AutomationPage },
  calendar: { Component: ContentCalendarPage },
  media: { Component: MediaLibraryPage },
  inbox: { Component: InboxPage },
  notifications: { Component: NotificationsPage },
  analytics: { Component: AnalyticsPage },
  search: { Component: GlobalSearchPage },
  workspace: { Component: WorkspacePage },
  audience: { Component: AudiencePage },
  playground: { Component: PlaygroundPage },
  studio: { Component: ContentStudioPage },
  prompts: { Component: PromptLibraryPage },
  aiHistory: { Component: AIHistoryPage },
  tokenAnalytics: { Component: TokenAnalyticsPage },
  aiSettings: { Component: AISettingsPage },
  brandVoice: { Component: BrandVoicePage },
  contentSources: { Component: ContentSourcesPage },
} = pages;

function App() {
  // Warm the chunks for the most-visited pages shortly after the shell paints,
  // so the very first in-app navigation feels instant rather than triggering
  // a fresh network fetch + Suspense fallback.
  useEffect(() => {
    const id = window.setTimeout(warmCommonPages, 1200);
    return () => window.clearTimeout(id);
  }, []);

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
                  <Route index element={<Navigate to="/app/assistant" replace />} />
                  <Route path="assistant" element={<AIAssistantPage />} />
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
                  <Route path="content-sources" element={<ContentSourcesPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                </Route>
                <Route path="/" element={<Navigate to="/app/assistant" replace />} />
                <Route path="*" element={<Navigate to="/app/assistant" replace />} />
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
