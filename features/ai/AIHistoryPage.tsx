import { useState } from 'react';
import { Activity, BarChart3, Clock, Copy, Download, Plus, Search, Star, TrendingUp, Trash2, Zap } from 'lucide-react';
import { useAIHistory, useAIAnalytics } from '@/hooks/useAIHistory';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, Card, CardSkeleton, EmptyState, ErrorState, Skeleton, Tabs } from '@/ui';
import { MarkdownRenderer } from '@/ui';
import { timeAgo } from '@/utils/format';
import type { AiHistoryEntry } from '@/types/ai';

type HistoryTab = 'log' | 'usage';

export function AIHistoryPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<HistoryTab>('log');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.history.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('ai.history.subtitle')}</p>
      </div>

      <Tabs
        tabs={[
          { id: 'log', label: t('ai.history.tab.log') },
          { id: 'usage', label: t('ai.history.tab.usage') },
        ]}
        active={tab}
        onChange={(id) => setTab(id as HistoryTab)}
      />

      {tab === 'log' ? <AIHistoryLogTab /> : <AIUsageTab />}
    </div>
  );
}

function AIHistoryLogTab() {
  const { t } = useLanguage();
  const { history, loading, error, search, toggleFavorite, remove } = useAIHistory();
  const { push } = useToast();
  const [query, setQuery] = useState('');
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = showFavOnly ? history.filter((h) => h.favorite) : history;

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-history.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    push({ title: t('ai.history.toast.copied'), variant: 'success' });
  };

  const handleReuse = (entry: AiHistoryEntry) => {
    navigator.clipboard.writeText(entry.input);
    push({ title: t('ai.history.toast.inputCopied'), description: t('ai.history.toast.inputCopiedDesc'), variant: 'success' });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4" /> {t('ai.history.exportButton')}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder={t('ai.history.searchPlaceholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              search(e.target.value);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 ps-9 pe-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <button
          onClick={() => setShowFavOnly((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
            showFavOnly ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'
          }`}
        >
          <Star className={`h-4 w-4 ${showFavOnly ? 'fill-amber-400' : ''}`} /> {t('ai.prompts.favoritesFilter')}
        </button>
      </div>

      {error ? (
        <ErrorState description={error} />
      ) : loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><EmptyState icon={<Search className="h-10 w-10" />} title={t('ai.history.empty.title')} description={t('ai.history.empty.description')} /></Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => (
            <div key={entry.id} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant={entry.status === 'success' ? 'success' : 'error'}>{entry.status}</Badge>
                  <Badge variant="info">{entry.type}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">{timeAgo(entry.created_at)}</span>
                  <button onClick={() => toggleFavorite(entry.id, !entry.favorite)} className="text-slate-400 hover:text-amber-500">
                    <Star className={`h-4 w-4 ${entry.favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                  </button>
                  <button onClick={() => handleReuse(entry)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title={t('ai.history.reuseInput')}><Plus className="h-4 w-4" /></button>
                  {entry.output && <button onClick={() => handleCopy(entry.output!)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" title={t('ai.history.copyOutput')}><Copy className="h-4 w-4" /></button>}
                  <button onClick={() => remove(entry.id)} className="text-slate-400 hover:text-rose-500" title={t('ai.history.delete')}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mt-3">
                {entry.type === 'ai_decision' ? (
                  <AIDecisionEntryBody entry={entry} t={t} />
                ) : (
                  <>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('ai.history.input.label')}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-300">{entry.input}</p>
                  </>
                )}
              </div>
              {entry.output && entry.type !== 'ai_decision' && (
                <div className="mt-3">
                  <button
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                    className="text-xs font-medium uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    {t('ai.history.output.label')} {expanded === entry.id ? '−' : '+'}
                  </button>
                  {expanded === entry.id && (
                    <div className="mt-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
                      <MarkdownRenderer content={entry.output} />
                    </div>
                  )}
                </div>
              )}
              {(entry.tokens_in > 0 || entry.tokens_out > 0) && (
                <div className="mt-2 flex gap-3 text-xs text-slate-400">
                  <span>{t('ai.history.inOut', { in: entry.tokens_in, out: entry.tokens_out })}</span>
                  {entry.response_time_ms && <span>{t('ai.playground.responseTimeMs', { ms: entry.response_time_ms })}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AIUsageTab() {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const { analytics, loading, error } = useAIAnalytics(days);

  if (error) return <ErrorState description={error} />;
  if (loading) return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>;
  if (!analytics || analytics.totalRequests === 0) {
    return (
      <Card><EmptyState icon={<BarChart3 className="h-10 w-10" />} title={t('ai.tokenAnalytics.empty.title')} description={t('ai.tokenAnalytics.empty.description')} /></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value={7}>{t('analytics.range.7d')}</option>
          <option value={30}>{t('analytics.range.30d')}</option>
          <option value={90}>{t('analytics.range.90d')}</option>
        </select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Activity className="h-5 w-5" />} label={t('ai.tokenAnalytics.stat.totalRequests')} value={analytics.totalRequests} tone="sky" />
        <StatCard icon={<Zap className="h-5 w-5" />} label={t('ai.tokenAnalytics.stat.totalTokens')} value={analytics.totalTokensIn + analytics.totalTokensOut} hint={t('ai.tokenAnalytics.stat.inOut', { in: analytics.totalTokensIn, out: analytics.totalTokensOut })} tone="amber" />
        <StatCard icon={<Clock className="h-5 w-5" />} label={t('ai.tokenAnalytics.stat.avgResponseTime')} value={`${analytics.avgResponseTime}ms`} tone="emerald" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label={t('ai.tokenAnalytics.stat.successRate')} value={`${analytics.successRate}%`} hint={t('ai.tokenAnalytics.stat.failureRate', { pct: analytics.failureRate })} tone="slate" />
      </div>

      {/* Prompt type breakdown — what kind of request (chat/image/etc), never
          which underlying model/provider served it: users of this
          multi-tenant app shouldn't see backend model routing, only their
          own usage. */}
      <Card title={t('ai.tokenAnalytics.promptTypes.title')} description={t('ai.tokenAnalytics.promptTypes.description')}>
        {analytics.byPromptType.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('ai.tokenAnalytics.models.noData')}</p>
        ) : (
          <div className="space-y-2">
            {analytics.byPromptType.map((pt) => {
              const maxReq = analytics.byPromptType[0].requests || 1;
              const pct = Math.round((pt.requests / maxReq) * 100);
              return (
                <div key={pt.type}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-300">{pt.type}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{t('ai.tokenAnalytics.models.reqTokens', { req: pt.requests, tok: pt.tokens })}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

const toneMap = {
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

// AI Control — Status (Phase 2, section 29). The `ai_history` log already
// carries every ai_decision entry logged by recordAIDecision (STEP 13); this
// renders that entry's structured metadata (decision/confidence/risk/task)
// as badges instead of the generic input/output text used for chat/content
// entries, since an AIDecision's `output` field is just the label string and
// its `input` is a JSON blob — neither is meant for a human to read raw.
function AIDecisionEntryBody({ entry, t }: { entry: AiHistoryEntry; t: (k: string, params?: Record<string, string | number>) => string }) {
  const meta = entry.metadata as {
    decision?: string;
    confidence?: number;
    reason?: string;
    risk?: string;
    task?: string;
    quality_score?: number | null;
  };
  const variant = meta.decision === 'EXECUTE' ? 'success' : meta.decision === 'ABORT' ? 'error' : meta.decision === 'HUMAN_REVIEW' ? 'warning' : 'info';
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {meta.task && <Badge variant="default">{meta.task === 'draft_generation' ? t('ai.history.decision.taskDraft') : t('ai.history.decision.taskSchedule')}</Badge>}
      {meta.decision && <Badge variant={variant} dot>{t(`assistant.aiDecision.label.${meta.decision}`)}</Badge>}
      {typeof meta.confidence === 'number' && <Badge variant="default">{t('assistant.aiDecision.confidence', { value: Math.round(meta.confidence * 100) })}</Badge>}
      {meta.risk && <Badge variant="default">{t(`assistant.aiDecision.risk.${meta.risk}`)}</Badge>}
      {typeof meta.quality_score === 'number' && <Badge variant="default">{t('assistant.quality.contentScore')} {meta.quality_score}/100</Badge>}
      {meta.reason && <p className="mt-1.5 w-full text-xs text-slate-500 dark:text-slate-400">{meta.reason}</p>}
    </div>
  );
}

function StatCard({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string | number; hint?: string; tone: keyof typeof toneMap }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneMap[tone]}`}>{icon}</div>
      <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
