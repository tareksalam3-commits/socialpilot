import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { AuthScreen } from '@/screens/AuthScreen';
import { BrandBrainOnboarding } from '@/screens/BrandBrainOnboarding';
import { AppShell } from '@/components/AppShell';
import { ScreenLoader, Button } from '@/components/ui';
import { AlertCircle } from 'lucide-react';
import type { BrandDna } from '@/lib/types';

function AppContent() {
  const { user, workspace, loading, signOut, refreshWorkspace } = useAuth();
  const [brandDna, setBrandDna] = useState<BrandDna | null>(null);
  const [dnaLoading, setDnaLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    if (!workspace) {
      setBrandDna(null);
      setDnaLoading(false);
      return;
    }
    supabase
      .from('brand_dna')
      .select('*')
      .eq('workspace_id', workspace.id)
      .maybeSingle()
      .then(({ data }) => {
        setBrandDna((data as BrandDna | null) ?? null);
        setDnaLoading(false);
      });
  }, [workspace]);

  // Auto-retry if workspace stays null for too long (signup may have partially failed)
  useEffect(() => {
    if (loading || !user || workspace) return;
    if (retryCount >= 2) return;
    const timer = setTimeout(() => {
      setRetryCount((c) => c + 1);
      refreshWorkspace();
    }, 3000);
    return () => clearTimeout(timer);
  }, [loading, user, workspace, retryCount, refreshWorkspace]);

  if (loading) return <ScreenLoader fullScreen />;

  if (!user) return <AuthScreen />;

  if (!workspace) {
    // After 2 failed retries, show error state with logout option
    if (retryCount >= 2) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-danger-500/15 border border-danger-500/30 flex items-center justify-center">
            <AlertCircle className="text-danger-400" size={32} />
          </div>
          <p className="text-ink-100 font-medium">تعذّر إنشاء مساحتك</p>
          <p className="text-ink-400 text-sm max-w-xs">
            حدث خطأ أثناء إعداد المساحة. حاول مرة أخرى أو سجّل خروج وأعد المحاولة.
          </p>
          <div className="flex gap-3 mt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRetryCount(0);
                refreshWorkspace();
              }}
            >
              إعادة المحاولة
            </Button>
            <Button variant="ghost" onClick={signOut} className="text-danger-400">
              تسجيل خروج
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 gap-4">
        <ScreenLoader label="جارٍ إعداد مساحتك..." />
        {retryCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setRetryCount(retryCount + 1);
              refreshWorkspace();
            }}
          >
            إعادة المحاولة
          </Button>
        )}
      </div>
    );
  }

  if (dnaLoading) return <ScreenLoader label="جارٍ التحميل..." />;

  // No brand DNA or still draft → onboarding
  if (!brandDna || brandDna.status === 'draft') {
    return <BrandBrainOnboarding />;
  }

  return <AppShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
