import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { LoadingScreen } from '@/ui';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label="Checking your session…" />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}
