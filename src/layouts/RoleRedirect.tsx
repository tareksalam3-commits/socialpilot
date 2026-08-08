import { Navigate } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { LoadingScreen } from '@/ui';
import { getPostLoginPath } from '@/utils/roles';

/** Used for `/` and any unmatched path. Detects the signed-in user's role
 * and sends them straight to their interface — the Super Admin panel or the
 * regular workspace app — without ever rendering a shared page in between. */
export function RoleRedirect() {
  const { user, profile, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) return <LoadingScreen label={t('common.checkingSession')} />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={getPostLoginPath(profile)} replace />;
}
