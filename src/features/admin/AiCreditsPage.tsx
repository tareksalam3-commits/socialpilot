import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Input, Table, TableCell, TableRow, TableSkeleton } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { aiCreditsRepository, type AdminAiCreditRow } from '@/repositories/admin/aiCreditsRepository';
import { formatDate } from '@/utils/format';

export function AiCreditsPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const [rows, setRows] = useState<AdminAiCreditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});

  const load = () => {
    setLoading(true);
    setError(null);
    aiCreditsRepository
      .list()
      .then(setRows)
      .catch((e) => setError(e instanceof Error ? e.message : t('admin.error.loadAiCreditsFailed')))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const saveLimit = async (id: string) => {
    const value = Number(editing[id]);
    if (Number.isNaN(value)) return;
    try {
      await aiCreditsRepository.setLimit(id, value);
      push({ title: t('admin.aiCredits.toast.updated'), variant: 'success' });
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  };

  const reset = async (id: string) => {
    try {
      await aiCreditsRepository.resetUsage(id);
      push({ title: t('admin.aiCredits.toast.reset'), variant: 'success' });
      load();
    } catch (e) {
      push({ title: t('admin.users.toast.failed'), description: e instanceof Error ? e.message : undefined, variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{t('admin.aiCredits.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('admin.aiCredits.subtitle')}</p>
      </div>

      <Card>
        {error && <ErrorState description={error} onRetry={load} />}
        {loading && !error && <TableSkeleton rows={6} cols={5} />}
        {!loading && !error && rows.length === 0 && <EmptyState title={t('admin.aiCredits.empty')} />}
        {!loading && !error && rows.length > 0 && (
          <Table
            headers={[
              t('admin.aiCredits.col.workspace'),
              t('admin.aiCredits.col.used'),
              t('admin.aiCredits.col.limit'),
              t('admin.aiCredits.col.periodStart'),
              t('admin.aiCredits.col.actions'),
            ]}
          >
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-slate-900 dark:text-white">{r.workspace_name}</TableCell>
                <TableCell>{r.credits_used.toLocaleString()}</TableCell>
                <TableCell className="w-40">
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      className="h-8 w-24"
                      value={editing[r.id] ?? String(r.credits_limit)}
                      onChange={(e) => setEditing({ ...editing, [r.id]: e.target.value })}
                    />
                    <Button size="sm" variant="outline" onClick={() => saveLimit(r.id)}>
                      {t('common.save')}
                    </Button>
                  </div>
                </TableCell>
                <TableCell>{formatDate(r.period_start)}</TableCell>
                <TableCell>
                  <Button size="sm" variant="ghost" onClick={() => reset(r.id)}>
                    <RotateCcw className="h-3.5 w-3.5" /> {t('admin.aiCredits.action.reset')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
