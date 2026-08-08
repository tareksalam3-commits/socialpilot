import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { LoadingScreen } from '@/ui';
import { isSuperAdmin } from '@/utils/roles';

/** Guards the regular `/app/*` workspace application. Super Admins are
 * routed to their own `/admin` panel instead — they never see the
 * workspace UI, keeping the two interfaces completely separate. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  if (loading) return <LoadingScreen label={t('common.checkingSession')} />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (isSuperAdmin(profile)) return <Navigate to="/admin" replace />;
  return <>{children}</>;
}
