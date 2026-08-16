import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Card, ScreenLoader, ErrorBanner, Badge } from '@/components/ui';

type AiRunRow = {
  id: string;
  provider: string | null;
  model: string | null;
  status: string;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  task: string;
  created_at: string;
};

function statusBadge(status: string) {
  if (status === 'succeeded') return <Badge color="brand">نجح</Badge>;
  if (status === 'failed') return <Badge color="danger">فشل</Badge>;
  return <Badge color="neutral">جارٍ</Badge>;
}

export function AiUsageScreen({ onBack }: { onBack: () => void }) {
  const { workspace } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<AiRunRow[]>([]);

  useEffect(() => {
    if (!workspace) return;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: qError } = await supabase
        .from('ai_runs')
        .select('id, provider, model, status, cost_usd, input_tokens, output_tokens, task, created_at')
        .eq('workspace_id', workspace.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (qError) {
        setError('تعذّر تحميل بيانات استهلاك الذكاء الاصطناعي');
      } else {
        setRows((data as AiRunRow[]) ?? []);
      }
      setLoading(false);
    })();
  }, [workspace]);

  const totals = rows.reduce(
    (acc, r) => {
      acc.requests += 1;
      acc.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0);
      acc.cost += r.cost_usd ?? 0;
      if (r.status === 'failed') acc.failures += 1;
      return acc;
    },
    { requests: 0, tokens: 0, cost: 0, failures: 0 }
  );

  if (loading) return <ScreenLoader fullScreen label="جارٍ تحميل بيانات الاستخدام..." />;

  return (
    <div className="px-5 py-6 safe-top pb-24">
      <div className="flex items-center gap-2 mb-6">
        <button onClick={onBack} className="text-ink-400">
          <ChevronRight size={22} />
        </button>
        <h1 className="text-lg font-bold text-ink-50">AI Usage</h1>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      <Card className="mb-5">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-ink-50 font-bold text-lg">{totals.requests}</p>
            <p className="text-ink-500 text-[10px] mt-0.5">طلبات</p>
          </div>
          <div>
            <p className="text-ink-50 font-bold text-lg">{totals.tokens.toLocaleString('en-US')}</p>
            <p className="text-ink-500 text-[10px] mt-0.5">Tokens</p>
          </div>
          <div>
            <p className="text-ink-50 font-bold text-lg">${totals.cost.toFixed(3)}</p>
            <p className="text-ink-500 text-[10px] mt-0.5">التكلفة</p>
          </div>
        </div>
      </Card>

      <p className="text-ink-500 text-xs mb-2">آخر العمليات</p>
      {rows.length === 0 ? (
        <Card>
          <p className="text-ink-400 text-sm text-center py-4">لسه مفيش استخدام مسجّل للذكاء الاصطناعي في المساحة دي</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.slice(0, 50).map((r) => (
            <Card key={r.id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-ink-200 text-sm font-medium">{r.task}</span>
                {statusBadge(r.status)}
              </div>
              <div className="flex items-center justify-between text-xs text-ink-500">
                <span>{r.provider ?? '—'} / {r.model ?? '—'}</span>
                <span dir="ltr">${(r.cost_usd ?? 0).toFixed(4)}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] text-ink-600 mt-1">
                <span>{(r.input_tokens ?? 0) + (r.output_tokens ?? 0)} tokens</span>
                <span dir="ltr">{new Date(r.created_at).toLocaleString('ar-EG')}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
