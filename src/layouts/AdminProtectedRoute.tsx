import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { LoadingScreen } from '@/ui';
import { isSuperAdmin } from '@/utils/roles';

/** Guards the entire `/admin` panel. Only signed-in users whose
 * `profile.platform_role === 'super_admin'` may pass — every other user
 * (including Workspace Owners) is redirected straight back into the
 * regular workspace app and never sees this panel exists. */
export function AdminProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  if (loading) return <LoadingScreen label={t('common.checkingSession')} />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!isSuperAdmin(profile)) return <Navigate to="/app/assistant" replace />;
  return <>{children}</>;
}
