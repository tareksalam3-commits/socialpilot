import { useState } from 'react';
import { Copy, Download, Plus, Search, Star, Trash2 } from 'lucide-react';
import { useAIHistory } from '@/hooks/useAIHistory';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@/ui';
import { MarkdownRenderer } from '@/ui';
import { timeAgo } from '@/utils/format';
import type { AiHistoryEntry } from '@/types/ai';

export function AIHistoryPage() {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.history.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('ai.history.subtitle')}</p>
        </div>
        <Button variant="outline" onClick={handleExport}><Download className="h-4 w-4" /> {t('ai.history.exportButton')}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            placeholder={t('ai.history.searchPlaceholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              search(e.target.value);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
                  {entry.model && <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{entry.model}</span>}
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
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('ai.history.input.label')}</p>
                <p className="mt-1 line-clamp-2 text-sm text-slate-700 dark:text-slate-300">{entry.input}</p>
              </div>
              {entry.output && (
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
