import { useEffect, useState } from 'react';
import { Sparkles, TrendingUp, AlertCircle, ArrowLeft, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { callAiGateway } from '@/lib/api';
import { Card, ScreenLoader, ErrorBanner, Button, Spinner } from '@/components/ui';
import type { SocialAccount, Content } from '@/lib/types';
import type { Tab } from '@/components/AppShell';

export function HomeScreen({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { workspace } = useAuth();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [recentContent, setRecentContent] = useState<Content[]>([]);
  const [loading, setLoading] = useState(true);
  const [advice, setAdvice] = useState<string | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    (async () => {
      const [accs, content] = await Promise.all([
        supabase.from('social_accounts').select('*').eq('workspace_id', workspace.id),
        supabase
          .from('content')
          .select('*')
          .eq('workspace_id', workspace.id)
          .order('created_at', { ascending: false })
          .limit(3),
      ]);
      setAccounts((accs.data as SocialAccount[]) ?? []);
      setRecentContent((content.data as Content[]) ?? []);
      setLoading(false);
    })();
  }, [workspace]);

  async function loadAdvice() {
    if (!workspace) return;
    setAdviceLoading(true);
    setAdviceError(null);
    try {
      const res = await callAiGateway({
        intent: 'general_advice',
        workspaceId: workspace.id,
        message: 'اقترح لي فكرة محتوى واحدة قوية لنشرها اليوم بناءً على براند',
      });
      const result = res.result as { advice?: string };
      setAdvice(result.advice ?? 'لا توجد اقتراحات حالياً');
    } catch (err) {
      setAdviceError(err instanceof Error ? err.message : 'فشل تحميل الاقتراحات');
    } finally {
      setAdviceLoading(false);
    }
  }

  if (loading) return <ScreenLoader />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'صباح الخير' : hour < 18 ? 'مساء الخير' : 'مساء الخير';
  const needsReconnect = accounts.filter((a) => a.needs_reconnect || a.status === 'error' || a.status === 'expired');
  const connectedCount = accounts.filter((a) => a.status === 'connected').length;

  return (
    <div className="px-5 py-6 safe-top">
      {/* Greeting */}
      <div className="mb-6">
        <p className="text-ink-400 text-sm">{greeting} 👋</p>
        <h1 className="text-2xl font-bold text-ink-50 mt-1">{workspace?.name}</h1>
      </div>

      {/* AI suggestion */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-brand-400" />
          <h2 className="text-sm font-medium text-ink-300">AI يقترح عليك اليوم</h2>
        </div>
        <Card className="bg-gradient-to-br from-brand-500/10 to-transparent border-brand-500/20">
          {adviceLoading ? (
            <div className="flex items-center gap-2 text-ink-400 text-sm py-2">
              <Spinner className="text-brand-400" /> يفكر...
            </div>
          ) : adviceError ? (
            <div>
              <ErrorBanner message={adviceError} />
              <Button variant="ghost" size="sm" onClick={loadAdvice} className="mt-2">إعادة المحاولة</Button>
            </div>
          ) : advice ? (
            <p className="text-ink-100 text-sm leading-relaxed">{advice}</p>
          ) : (
            <div>
              <p className="text-ink-300 text-sm mb-3">
                خلّي AI يقترح لك محتوى مناسب لبراندك اليوم
              </p>
              <Button size="sm" onClick={loadAdvice}>
                <span className="flex items-center gap-1.5">
                  <Zap size={14} /> اقترح لي
                </span>
              </Button>
            </div>
          )}
        </Card>
      </div>

      {/* Needs attention */}
      {needsReconnect.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={18} className="text-warning-400" />
            <h2 className="text-sm font-medium text-ink-300">يحتاج انتباهك</h2>
          </div>
          <div className="flex flex-col gap-2">
            {needsReconnect.map((acc) => (
              <Card key={acc.id} className="flex items-center justify-between">
                <div>
                  <p className="text-ink-100 text-sm">{acc.platform}</p>
                  <p className="text-warning-400 text-xs mt-0.5">الحساب يحتاج إعادة ربط</p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => onNavigate('more')}>
                  ربط
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Performance snapshot */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={18} className="text-accent-400" />
          <h2 className="text-sm font-medium text-ink-300">أداء المحتوى</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <p className="text-ink-500 text-xs mb-1">المحتوى المنشور</p>
            <p className="text-2xl font-bold text-ink-50">{recentContent.length}</p>
          </Card>
          <Card>
            <p className="text-ink-500 text-xs mb-1">حسابات مربوطة</p>
            <p className="text-2xl font-bold text-ink-50">{connectedCount}</p>
          </Card>
        </div>
      </div>

      {/* Recent content */}
      {recentContent.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-ink-300">آخر محتوى</h2>
            <button onClick={() => onNavigate('content')} className="text-ink-500 text-xs flex items-center gap-1">
              الكل <ArrowLeft size={12} />
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {recentContent.map((c) => (
              <Card key={c.id} onClick={() => onNavigate('content')}>
                <p className="text-ink-100 text-sm font-medium truncate">{c.title}</p>
                <p className="text-ink-500 text-xs mt-1">{c.status}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Quick ask */}
      <div className="mb-4">
        <Button variant="secondary" size="lg" className="w-full" onClick={() => onNavigate('create')}>
          <span className="flex items-center justify-center gap-2">
            <Sparkles size={18} /> اسأل AI — ماذا تريد أن تحقق؟
          </span>
        </Button>
      </div>
    </div>
  );
}
