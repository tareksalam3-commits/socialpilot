import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
  Plus,
  Rss,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Youtube,
  Globe,
  RefreshCw,
} from 'lucide-react';
import { useContentSources } from '@/hooks/useContentSources';
import { useLanguage } from '@/providers/LanguageProvider';
import { useToast } from '@/providers/ToastProvider';
import { Badge, Button, Card, EmptyState, Input, Modal, Skeleton } from '@/ui';
import type { ContentSource, ContentSourceType } from '@/types/contentSources';
import { CONTENT_SOURCE_LIMIT } from '@/types/contentSources';

const LINK_TYPES: { type: Extract<ContentSourceType, 'rss' | 'url' | 'youtube'>; icon: typeof Rss }[] = [
  { type: 'rss', icon: Rss },
  { type: 'url', icon: Globe },
  { type: 'youtube', icon: Youtube },
];

const FILE_TYPES: { type: Extract<ContentSourceType, 'pdf' | 'word' | 'excel'>; icon: typeof FileText; accept: string }[] = [
  { type: 'pdf', icon: FileText, accept: '.pdf,application/pdf' },
  { type: 'word', icon: FileText, accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { type: 'excel', icon: FileSpreadsheet, accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
];

const PLATFORM_OPTIONS = ['linkedin', 'twitter', 'facebook', 'instagram'];

function sourceIcon(type: ContentSourceType) {
  switch (type) {
    case 'rss': return Rss;
    case 'url': return Globe;
    case 'youtube': return Youtube;
    case 'excel': return FileSpreadsheet;
    default: return FileText;
  }
}

function statusVariant(status: ContentSource['status']): 'default' | 'success' | 'warning' | 'error' | 'info' {
  switch (status) {
    case 'ready': return 'success';
    case 'fetching': return 'info';
    case 'error': return 'error';
    default: return 'default';
  }
}

export function ContentSourcesPage() {
  const { t } = useLanguage();
  const { push } = useToast();
  const {
    sources, loading, error,
    addLinkSource, addFileSource, removeSource,
    fetching, proposedItems, fetchErrors, fetchNewContent,
    selectedItems, toggleSelected, selectedHashes,
    generating, generatedDrafts, generationError, generatePosts,
    regenerateDraft, removeDraft,
    scheduling, confirmSchedule,
  } = useContentSources();

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [linkType, setLinkType] = useState<'rss' | 'url' | 'youtube'>('rss');
  const [linkUrl, setLinkUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [prompt, setPrompt] = useState('');
  const [platforms, setPlatforms] = useState<string[]>(['linkedin', 'twitter']);

  const atLimit = sources.length >= CONTENT_SOURCE_LIMIT;

  const handleAddLink = async () => {
    if (!linkUrl.trim()) return;
    setAdding(true);
    try {
      await addLinkSource(linkType, linkUrl.trim());
      setLinkUrl('');
      setAddModalOpen(false);
      push({ title: t('contentSources.toast.added'), variant: 'success' });
    } catch (e) {
      push({ title: t('contentSources.toast.addFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const handleFileSelected = async (type: 'pdf' | 'word' | 'excel', file: File | undefined) => {
    if (!file) return;
    setAdding(true);
    try {
      await addFileSource(type, file);
      push({ title: t('contentSources.toast.added'), variant: 'success' });
    } catch (e) {
      push({ title: t('contentSources.toast.addFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (source: ContentSource) => {
    await removeSource(source);
    push({ title: t('contentSources.toast.removed'), variant: 'success' });
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || selectedItems.length === 0) return;
    await generatePosts(prompt.trim(), platforms);
  };

  const handleConfirmSchedule = async () => {
    try {
      await confirmSchedule();
      push({ title: t('contentSources.toast.scheduled'), variant: 'success' });
      setPrompt('');
    } catch (e) {
      push({ title: t('contentSources.toast.scheduleFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('contentSources.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('contentSources.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => fetchNewContent()} loading={fetching} disabled={sources.length === 0}>
            <RefreshCw className="h-4 w-4" /> {t('contentSources.fetchButton')}
          </Button>
          <Button onClick={() => setAddModalOpen(true)} disabled={atLimit}>
            <Plus className="h-4 w-4" /> {t('contentSources.addButton')}
          </Button>
        </div>
      </div>

      {atLimit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          {t('contentSources.limitReached')}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Sources list */}
      <Card title={`${t('contentSources.list.title')} (${sources.length}/${CONTENT_SOURCE_LIMIT})`}>
        {sources.length === 0 ? (
          <EmptyState
            icon={<Link2 className="h-6 w-6" />}
            title={t('contentSources.list.empty')}
            description={t('contentSources.list.emptyDesc')}
            action={<Button onClick={() => setAddModalOpen(true)}><Plus className="h-4 w-4" /> {t('contentSources.addButton')}</Button>}
          />
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {sources.map((source) => {
              const Icon = sourceIcon(source.type);
              return (
                <div key={source.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {source.name || source.source_url || source.file_path}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {source.last_fetched_at
                          ? `${t('contentSources.list.lastFetched')}: ${new Date(source.last_fetched_at).toLocaleString()}`
                          : t('contentSources.list.neverFetched')}
                        {source.last_error ? ` · ${source.last_error}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={statusVariant(source.status)} dot>{t(`contentSources.status.${source.status}`)}</Badge>
                    <button
                      onClick={() => handleRemove(source)}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/50"
                      aria-label={t('common.delete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Proposed content */}
      {(proposedItems.length > 0 || fetchErrors.length > 0 || fetching) && (
        <Card title={t('contentSources.proposed.title')}>
          {fetching && (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> {t('contentSources.proposed.loading')}
            </div>
          )}

          {!fetching && fetchErrors.length > 0 && (
            <div className="mb-4 space-y-1 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300">
              {fetchErrors.map((err) => <p key={err.source_id}>{err.error}</p>)}
            </div>
          )}

          {!fetching && proposedItems.length === 0 && fetchErrors.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('contentSources.proposed.empty')}</p>
          ) : (
            <div className="space-y-3">
              {proposedItems.map((item) => {
                const Icon = sourceIcon(item.source_type);
                const checked = selectedHashes.has(item.content_hash);
                return (
                  <label
                    key={item.content_hash}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-800'}`}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleSelected(item.content_hash)} className="mt-1 h-4 w-4 rounded border-slate-300" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{item.title}</p>
                      </div>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.summary}</p>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-sky-600 hover:underline dark:text-sky-400">
                          {item.url}
                        </a>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* AI generation */}
      {selectedItems.length > 0 && (
        <Card title={t('contentSources.generate.title')}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('contentSources.generate.promptLabel')}</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder={t('contentSources.generate.promptPlaceholder')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('contentSources.generate.platformsLabel')}</label>
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]))}
                    className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors ${platforms.includes(p) ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            {generationError && <p className="text-sm text-rose-600 dark:text-rose-400">{generationError}</p>}
            <Button onClick={handleGenerate} loading={generating} disabled={!prompt.trim()}>
              <Sparkles className="h-4 w-4" /> {t('contentSources.generate.button')} ({selectedItems.length})
            </Button>
          </div>
        </Card>
      )}

      {/* Generated drafts preview — every draft is run through the same
          Arabic Content Quality Control pipeline as the AI Assistant before
          it's eligible for scheduling; see useContentSources.generatePosts. */}
      {generatedDrafts.length > 0 && (
        <Card title={`${t('contentSources.drafts.title')} (${generatedDrafts.length})`}>
          <div className="space-y-3">
            {generatedDrafts.map((draft, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${
                    draft.checking
                      ? 'border-slate-200 dark:border-slate-800'
                      : draft.approved
                        ? 'border-emerald-200 dark:border-emerald-800'
                        : 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    {draft.checking ? (
                      <Badge variant="info">
                        <Loader2 className="h-3 w-3 animate-spin" /> {t('contentSources.drafts.badge.checking')}
                      </Badge>
                    ) : draft.approved ? (
                      <Badge variant="success">
                        <ShieldCheck className="h-3 w-3" /> {t('contentSources.drafts.badge.approved')}
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <AlertTriangle className="h-3 w-3" /> {t('contentSources.drafts.badge.needsReview')}
                      </Badge>
                    )}
                    <div className="flex items-center gap-1">
                      {!draft.checking && !draft.approved && (
                        <Button size="sm" variant="ghost" onClick={() => regenerateDraft(i)}>
                          <RefreshCw className="h-3.5 w-3.5" /> {t('contentSources.drafts.regenerateButton')}
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => removeDraft(i)}>
                        <Trash2 className="h-3.5 w-3.5" /> {t('contentSources.drafts.removeButton')}
                      </Button>
                    </div>
                  </div>

                  <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{draft.content}</p>

                  {!draft.checking && !draft.approved && (
                    <div className="mt-2 rounded-md bg-amber-100/70 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      <p className="font-medium">{t('contentSources.drafts.issuesLabel')}</p>
                      {draft.quality_error ? (
                        <p>{t('contentSources.drafts.qcUnavailable')}</p>
                      ) : draft.quality?.issues?.length ? (
                        <ul className="mt-1 list-inside list-disc space-y-0.5">
                          {draft.quality.issues.map((issue, idx) => <li key={idx}>{issue}</li>)}
                        </ul>
                      ) : (
                        <p>{t('contentSources.drafts.qcUnavailable')}</p>
                      )}
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {draft.platforms.map((p) => <Badge key={p}>{p}</Badge>)}
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {new Date(draft.scheduled_for).toLocaleString()}
                    </span>
                  </div>
                </div>
            ))}
            <Button
              onClick={handleConfirmSchedule}
              loading={scheduling}
              disabled={generatedDrafts.every((d) => d.checking) || generatedDrafts.every((d) => !d.approved)}
            >
              <CheckCircle2 className="h-4 w-4" />
              {t('contentSources.drafts.confirmButton', { count: generatedDrafts.filter((d) => d.approved && !d.checking).length })}
            </Button>
          </div>
        </Card>
      )}

      {/* Add source modal */}
      <Modal open={addModalOpen} onClose={() => setAddModalOpen(false)} title={t('contentSources.addModal.title')} size="md">
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{t('contentSources.addModal.linkSection')}</p>
            <div className="mb-3 flex gap-2">
              {LINK_TYPES.map(({ type, icon: Icon }) => (
                <button
                  key={type}
                  onClick={() => setLinkType(type)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${linkType === type ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}
                >
                  <Icon className="h-3.5 w-3.5" /> {t(`contentSources.type.${type}`)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder={t(`contentSources.addModal.placeholder.${linkType}`)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddLink())}
              />
              <Button onClick={handleAddLink} loading={adding} disabled={!linkUrl.trim()}>{t('common.save')}</Button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{t('contentSources.addModal.fileSection')}</p>
            <div className="grid grid-cols-3 gap-2">
              {FILE_TYPES.map(({ type, icon: Icon, accept }) => (
                <div key={type}>
                  <input
                    ref={(el) => { fileInputRefs.current[type] = el; }}
                    type="file"
                    accept={accept}
                    className="hidden"
                    onChange={(e) => handleFileSelected(type, e.target.files?.[0]).then(() => { if (e.target) e.target.value = ''; })}
                  />
                  <button
                    onClick={() => fileInputRefs.current[type]?.click()}
                    disabled={adding}
                    className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-4 text-xs font-medium text-slate-600 transition-colors hover:border-slate-400 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400"
                  >
                    <Upload className="h-4 w-4" />
                    <Icon className="h-3.5 w-3.5" />
                    {t(`contentSources.type.${type}`)}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
