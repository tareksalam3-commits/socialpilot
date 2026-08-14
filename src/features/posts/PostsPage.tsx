import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  FileText,
  Image as ImageIcon,
  List,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { usePosts } from '@/hooks/usePosts';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAISettings } from '@/hooks/useAISettings';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { publishingLogRepository } from '@/repositories/publishingLogRepository';
import { publishingService } from '@/services/publishingService';
import { reviewGeneratedContent, validateFinalPostContent } from '@/engines/aiOrchestrator';
import { getContentWorkflow, updateGeneratedContent } from '@/services/contentPersistence';
import { MediaPicker } from '@/features/media/MediaPicker';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Table, TableRow, TableCell } from '@/ui';
import { formatDateTime } from '@/utils/format';
import type { Post, PostStatus, PublishingLog } from '@/types/social';
import { PLATFORM_IDS } from '@/constants/platforms';
import { getPlatformMeta } from '@/constants/platforms';

const statusOptions: PostStatus[] = ['draft', 'scheduled', 'publishing', 'published', 'failed', 'archived'];
const platformOptions = PLATFORM_IDS;

type PostsViewMode = 'list' | 'calendar';
type CalendarViewMode = 'month' | 'week' | 'day';

function platformColor(platform: string): string {
  return getPlatformMeta(platform)?.badgeClass ?? '';
}

const statusColors: Record<string, string> = {
  draft: 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
  scheduled: 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950',
  publishing: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
  published: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
  failed: 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950',
  archived: 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
};

export function PostsPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage();
  const {
    posts,
    loading,
    error,
    create,
    update,
    remove,
    duplicate,
    filterStatus,
    setFilterStatus,
    filterPlatform,
    setFilterPlatform,
    searchQuery,
    setSearchQuery,
    reload,
  } = usePosts();
  const { workspace } = useWorkspace();
  const { settings: aiSettings } = useAISettings();
  const { push } = useToast();

  const [viewMode, setViewMode] = useState<PostsViewMode>('list');

  // Shared create/edit editor state — used identically from the list (table)
  // view and from the calendar view, so switching views never loses in-flight
  // edits or opens a second, divergent modal.
  const [showEditor, setShowEditor] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', content: '', platforms: [] as string[], scheduled_for: '', media_urls: [] as string[] });

  const handleNew = () => {
    setEditing(null);
    setForm({ title: '', content: '', platforms: [], scheduled_for: '', media_urls: [] });
    setShowEditor(true);
  };

  const handleEdit = (post: Post) => {
    setEditing(post);
    setForm({
      title: post.title ?? '',
      content: post.content,
      platforms: post.platforms,
      scheduled_for: post.scheduled_for ? new Date(post.scheduled_for).toISOString().slice(0, 16) : '',
      media_urls: post.media_urls ?? [],
    });
    setShowEditor(true);
  };

  const handleAttachMedia = (urls: string[]) => {
    setForm((f) => ({ ...f, media_urls: [...f.media_urls, ...urls.filter((u) => !f.media_urls.includes(u))] }));
  };

  const handleRemoveMedia = (url: string) => {
    setForm((f) => ({ ...f, media_urls: f.media_urls.filter((u) => u !== url) }));
  };

  const handleSave = async () => {
    if (!form.content.trim()) {
      push({ title: t('posts.toast.contentRequired'), variant: 'error' });
      return;
    }
    const willSchedule = !!form.scheduled_for;
    if (willSchedule) {
      const check = validateFinalPostContent(form.content);
      if (!check.valid) {
        push({ title: t('posts.toast.qualityBlocked'), description: check.reasons.join(', '), variant: 'error' });
        return;
      }
    }
    if (editing) {
      const result = await update(editing.id, {
        title: form.title || null,
        content: form.content,
        platforms: form.platforms,
        media_urls: form.media_urls,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
        status: form.scheduled_for ? 'scheduled' : 'draft',
      });
      if (!result) {
        push({ title: t('posts.toast.saveFailed'), variant: 'error' });
        return;
      }
      push({ title: t('posts.toast.updated'), variant: 'success' });
    } else {
      const result = await create({
        title: form.title || undefined,
        content: form.content,
        platforms: form.platforms,
        media_urls: form.media_urls,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
        status: form.scheduled_for ? 'scheduled' : 'draft',
      });
      if (!result) {
        push({ title: t('posts.toast.saveFailed'), variant: 'error' });
        return;
      }
      push({ title: t('posts.toast.created'), variant: 'success' });
    }
    setShowEditor(false);
  };

  const handleQualityReview = async (post: Post) => {
    if (!workspace) return;
    setReviewingId(post.id);
    try {
      const reviewed = await reviewGeneratedContent(
        workspace.id,
        post.content,
        post.platforms,
        null,
        { model: aiSettings?.default_model, maxTokens: aiSettings?.max_tokens, freeOnly: aiSettings?.free_only_mode },
      );
      if (!reviewed.result) {
        push({ title: t('contentWorkspace.reviewFailed'), description: reviewed.error ?? undefined, variant: 'error' });
        return;
      }

      const workflow = getContentWorkflow(post);
      await updateGeneratedContent(post.id, {
        title: post.title ?? undefined,
        content: post.content,
        platforms: post.platforms,
        mediaUrls: post.media_urls,
        scheduledFor: post.scheduled_for,
        source: workflow?.source ?? 'content_workspace',
        sourceLabel: workflow?.source_label ?? 'Content Workspace',
        stage: reviewed.result.approved ? 'approved' : 'in_review',
        quality: reviewed.result,
        needsReview: !reviewed.result.approved,
        platformVariants: workflow?.platform_variants ?? null,
      });
      await reload();
      push({
        title: reviewed.result.approved ? t('contentWorkspace.reviewApproved') : t('contentWorkspace.reviewNeedsWork'),
        variant: reviewed.result.approved ? 'success' : 'info',
      });
    } catch (reviewError) {
      push({
        title: t('contentWorkspace.reviewFailed'),
        description: reviewError instanceof Error ? reviewError.message : undefined,
        variant: 'error',
      });
    } finally {
      setReviewingId(null);
    }
  };

  const handlePublish = async (post: Post) => {
    if (!workspace) return;
    const check = validateFinalPostContent(post.content);
    if (!check.valid) {
      push({ title: t('posts.toast.qualityBlocked'), description: check.reasons.join(', '), variant: 'error' });
      return;
    }
    setPublishing(true);
    try {
      await publishingService.publishNow(post.id, workspace.id);
      push({ title: t('posts.toast.published.title'), description: t('posts.toast.published.description'), variant: 'success' });
    } catch (e) {
      push({ title: t('posts.toast.publishFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setPublishing(false);
    }
  };

  const handleArchive = async (post: Post) => {
    await update(post.id, { status: 'archived' });
    push({ title: t('posts.toast.archived'), variant: 'success' });
  };

  const handleRestore = async (post: Post) => {
    await update(post.id, { status: 'draft' });
    push({ title: t('posts.toast.restored'), variant: 'success' });
  };

  const togglePlatform = (p: string) => {
    setForm((f) => ({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!embedded && (
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('posts.title')}</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('posts.subtitle')}</p>
          </div>
        )}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${viewMode === 'list' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}`}
            >
              <List className="h-3.5 w-3.5" /> {t('posts.view.list')}
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${viewMode === 'calendar' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}`}
            >
              <CalendarDays className="h-3.5 w-3.5" /> {t('posts.view.calendar')}
            </button>
          </div>
          <Button onClick={handleNew}><Plus className="h-4 w-4" /> {t('posts.newPost')}</Button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <PostsListView
          posts={posts}
          loading={loading}
          error={error}
          publishing={publishing}
          filterStatus={filterStatus}
          setFilterStatus={setFilterStatus}
          filterPlatform={filterPlatform}
          setFilterPlatform={setFilterPlatform}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onNew={handleNew}
          onEdit={handleEdit}
          onPublish={handlePublish}
          onReview={handleQualityReview}
          reviewingId={reviewingId}
          onDuplicate={duplicate}
          onArchive={handleArchive}
          onRestore={handleRestore}
          onRemove={remove}
        />
      ) : (
        <PostsCalendarView posts={posts} update={update} onEdit={handleEdit} />
      )}

      {viewMode === 'list' && <PublishingLogPanel />}

      {/* Shared create/edit editor — identical whichever view triggered it. */}
      <Modal open={showEditor} onClose={() => setShowEditor(false)} title={editing ? t('posts.editor.titleEdit') : t('posts.editor.titleNew')} size="lg"
        footer={<><Button variant="outline" onClick={() => setShowEditor(false)}>{t('common.cancel')}</Button><Button onClick={handleSave}>{editing ? t('common.save') : t('posts.editor.create')}</Button></>}>
        <div className="space-y-4">
          <Input label={t('posts.editor.titleLabel')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={t('posts.editor.titlePlaceholder')} />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('posts.editor.contentLabel')}</label>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={5} placeholder={t('posts.editor.contentPlaceholder')} className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('posts.editor.platformsLabel')}</label>
            <div className="flex flex-wrap gap-2">
              {platformOptions.map((p) => (
                <button key={p} onClick={() => togglePlatform(p)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${form.platforms.includes(p) ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}>{p}</button>
              ))}
            </div>
          </div>
          <Input label={t('posts.editor.scheduleLabel')} type="datetime-local" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} />

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{t('posts.editor.mediaLabel')}</label>
              <Button variant="outline" size="sm" onClick={() => setShowMediaPicker(true)}>
                <ImageIcon className="h-3.5 w-3.5" /> {t('posts.editor.addMedia')}
              </Button>
            </div>
            {form.media_urls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {form.media_urls.map((url) => (
                  <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button
                      onClick={() => handleRemoveMedia(url)}
                      className="absolute end-1 top-1 rounded-full bg-white/90 p-0.5 text-slate-600 opacity-0 transition group-hover:opacity-100 dark:bg-slate-900/90 dark:text-slate-300"
                      title={t('posts.editor.removeMedia')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('posts.editor.previewLabel')}</label>
            <Card className="space-y-2 bg-slate-50 dark:bg-slate-900/50">
              {form.media_urls.length > 0 ? (
                <div className={`grid gap-1 ${form.media_urls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {form.media_urls.map((url) => (
                    <img key={url} src={url} alt="" className="max-h-56 w-full rounded-lg object-cover" />
                  ))}
                </div>
              ) : (
                <p className="text-xs italic text-slate-400 dark:text-slate-500">{t('posts.editor.previewTextOnly')}</p>
              )}
              <p className="whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200">{form.content || t('posts.editor.previewEmpty')}</p>
            </Card>
          </div>
        </div>
      </Modal>

      <MediaPicker open={showMediaPicker} onClose={() => setShowMediaPicker(false)} onAttach={handleAttachMedia} />
    </div>
  );
}

/** Table/list view — filters, search, and the full posts table. */
function PostsListView({
  posts,
  loading,
  error,
  publishing,
  filterStatus,
  setFilterStatus,
  filterPlatform,
  setFilterPlatform,
  searchQuery,
  setSearchQuery,
  onNew,
  onEdit,
  onPublish,
  onReview,
  reviewingId,
  onDuplicate,
  onArchive,
  onRestore,
  onRemove,
}: {
  posts: Post[];
  loading: boolean;
  error: string | null;
  publishing: boolean;
  filterStatus: PostStatus | null;
  setFilterStatus: (s: PostStatus | null) => void;
  filterPlatform: string | null;
  setFilterPlatform: (p: string | null) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onNew: () => void;
  onEdit: (p: Post) => void;
  onPublish: (p: Post) => void;
  onReview: (p: Post) => void;
  reviewingId: string | null;
  onDuplicate: (id: string) => void;
  onArchive: (p: Post) => void;
  onRestore: (p: Post) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" placeholder={t('posts.searchPlaceholder')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white py-2 ps-9 pe-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        </div>
        <select value={filterStatus ?? ''} onChange={(e) => setFilterStatus((e.target.value as PostStatus) || null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <option value="">{t('posts.filter.allStatuses')}</option>
          {statusOptions.map((s) => <option key={s} value={s}>{t(`post.status.${s}`)}</option>)}
        </select>
        <select value={filterPlatform ?? ''} onChange={(e) => setFilterPlatform(e.target.value || null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <option value="">{t('posts.filter.allPlatforms')}</option>
          {platformOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {error ? (
        <ErrorState description={error} />
      ) : loading ? (
        <p className="py-6 text-center text-sm text-slate-500">{t('posts.loading')}</p>
      ) : posts.length === 0 ? (
        <Card><EmptyState icon={<CalendarClock className="h-10 w-10" />} title={t('posts.empty.title')} description={t('posts.empty.description')} action={<Button onClick={onNew}><Plus className="h-4 w-4" /> {t('posts.empty.action')}</Button>} /></Card>
      ) : (
        <Card>
          <Table headers={[t('posts.table.status'), t('posts.table.content'), t('posts.table.platforms'), t('posts.table.scheduled'), t('posts.table.actions')]}>
            {posts.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant={p.status === 'published' ? 'success' : p.status === 'scheduled' ? 'info' : p.status === 'failed' ? 'error' : p.status === 'archived' ? 'warning' : 'default'}>{t(`post.status.${p.status}`)}</Badge>
                    {getContentWorkflow(p)?.stage && (
                      <Badge variant={getContentWorkflow(p)?.stage === 'approved' ? 'success' : getContentWorkflow(p)?.stage === 'in_review' ? 'warning' : 'info'}>
                        {t(`contentWorkspace.stage.${getContentWorkflow(p)?.stage}`)}
                      </Badge>
                    )}
                    {(getContentWorkflow(p)?.needs_review || (p.metadata?.assistant as { needs_review?: boolean } | undefined)?.needs_review) && (
                      <Badge variant="warning">{t('posts.badge.needsReview')}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-xs">
                  {p.title && <p className="text-xs font-medium text-slate-900 dark:text-white">{p.title}</p>}
                  <p className="truncate text-sm text-slate-600 dark:text-slate-400">{p.content || t('posts.noContent')}</p>
                </TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.platforms.length > 0 ? p.platforms.join(', ') : '—'}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.scheduled_for ? formatDateTime(p.scheduled_for) : '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {(p.status === 'draft' || p.status === 'failed') && (
                      <button onClick={() => onPublish(p)} disabled={publishing} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800" title={t('posts.action.publishNow')}><Send className="h-3.5 w-3.5" /></button>
                    )}
                    {p.status === 'draft' && (
                      <button onClick={() => onReview(p)} disabled={reviewingId === p.id} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600 disabled:opacity-50 dark:hover:bg-slate-800" title={t('contentWorkspace.reviewAction')}>
                        <ShieldCheck className={`h-3.5 w-3.5 ${reviewingId === p.id ? 'animate-pulse' : ''}`} />
                      </button>
                    )}
                    <button onClick={() => onEdit(p)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title={t('posts.action.edit')}><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => onDuplicate(p.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title={t('posts.action.duplicate')}><Copy className="h-3.5 w-3.5" /></button>
                    {p.status === 'archived' ? (
                      <button onClick={() => onRestore(p)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title={t('posts.action.restore')}><RotateCcw className="h-3.5 w-3.5" /></button>
                    ) : (
                      <button onClick={() => onArchive(p)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title={t('posts.action.archive')}><FileText className="h-3.5 w-3.5" /></button>
                    )}
                    <button onClick={() => onRemove(p.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800" title={t('posts.action.delete')}><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

/** Calendar view — month/week/day grid with drag-to-reschedule. Editing a
 * post always opens the shared editor modal owned by the parent. */
function PostsCalendarView({
  posts,
  update,
  onEdit,
}: {
  posts: Post[];
  update: (id: string, patch: Partial<Post>) => Promise<Post | null>;
  onEdit: (p: Post) => void;
}) {
  const { t } = useLanguage();
  const { push } = useToast();
  const [view, setView] = useState<CalendarViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState('');

  const viewLabels: Record<CalendarViewMode, string> = {
    month: t('calendar.view.month'),
    week: t('calendar.view.week'),
    day: t('calendar.view.day'),
  };

  const weekdayLabels = [
    t('calendar.weekday.sun'),
    t('calendar.weekday.mon'),
    t('calendar.weekday.tue'),
    t('calendar.weekday.wed'),
    t('calendar.weekday.thu'),
    t('calendar.weekday.fri'),
    t('calendar.weekday.sat'),
  ];

  const postsByDate = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      const d = p.scheduled_for ?? p.published_at ?? p.created_at;
      const key = d.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [posts]);

  const navigate = (dir: number) => {
    const d = new Date(currentDate);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else if (view === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setDate(d.getDate() + dir);
    setCurrentDate(d);
  };

  const handleDrop = useCallback(async (postId: string, dateStr: string) => {
    const newDate = new Date(dateStr);
    newDate.setHours(9, 0, 0, 0);
    const result = await update(postId, { scheduled_for: newDate.toISOString(), status: 'scheduled' });
    if (!result) {
      push({ title: t('calendar.toast.qualityBlocked'), variant: 'error' });
      return;
    }
    push({
      title: t('calendar.toast.rescheduled.title'),
      description: t('calendar.toast.rescheduled.description', { date: formatDateTime(newDate.toISOString()) }),
      variant: 'success',
    });
  }, [update, push, t]);

  const days = useMemo(() => {
    if (view === 'day') return [currentDate];
    const start = new Date(currentDate);
    if (view === 'month') {
      start.setDate(1);
      const startDay = start.getDay();
      start.setDate(1 - startDay);
    } else {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
    }
    const count = view === 'month' ? 42 : 7;
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [currentDate, view]);

  const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const weekLabel = `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${days[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const dayLabel = currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg border border-slate-200 dark:border-slate-800">
          {(['month', 'week', 'day'] as CalendarViewMode[]).map((m) => (
            <button key={m} onClick={() => setView(m)} className={`px-3 py-1.5 text-xs font-medium transition ${view === m ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}`}>{viewLabels[m]}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => navigate(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>{t('calendar.today')}</Button>
        </div>
      </div>

      <p className="text-lg font-semibold text-slate-900 dark:text-white">{view === 'month' ? monthLabel : view === 'week' ? weekLabel : dayLabel}</p>

      {view === 'day' ? (
        <div className="space-y-3">
          {(postsByDate.get(currentDate.toISOString().slice(0, 10)) ?? []).map((p) => (
            <CalendarPost key={p.id} post={p} onClick={() => setSelectedPost(p)} />
          ))}
          {(!postsByDate.get(currentDate.toISOString().slice(0, 10)) || postsByDate.get(currentDate.toISOString().slice(0, 10))!.length === 0) && (
            <Card><p className="py-6 text-center text-sm text-slate-500">{t('calendar.noPostsToday')}</p></Card>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {weekdayLabels.map((d) => (
            <div key={d} className="pb-1 text-center text-xs font-semibold uppercase text-slate-400">{d}</div>
          ))}
          {days.map((d) => {
            const dateStr = d.toISOString().slice(0, 10);
            const dayPosts = postsByDate.get(dateStr) ?? [];
            const isToday = dateStr === new Date().toISOString().slice(0, 10);
            const isCurrentMonth = view === 'week' || d.getMonth() === currentDate.getMonth();
            return (
              <div
                key={dateStr}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); handleDrop(id, dateStr); }}
                className={`min-h-[80px] rounded-lg border p-1.5 ${isToday ? 'border-slate-400 dark:border-slate-500' : 'border-slate-200 dark:border-slate-800'} ${!isCurrentMonth ? 'opacity-40' : ''}`}
              >
                <p className={`mb-1 text-xs font-medium ${isToday ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{d.getDate()}</p>
                <div className="space-y-1">
                  {dayPosts.slice(0, 3).map((p) => (
                    <div key={p.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)} onClick={() => setSelectedPost(p)} className={`cursor-move rounded border px-1.5 py-1 text-xs ${statusColors[p.status] ?? statusColors.draft}`}>
                      <p className="truncate">{p.title ?? (p.content.slice(0, 30) || t('calendar.untitled'))}</p>
                      {p.platforms.slice(0, 2).map((pl) => <span key={pl} className={`me-1 inline-block rounded px-1 text-[10px] ${platformColor(pl)}`}>{pl.slice(0, 2)}</span>)}
                    </div>
                  ))}
                  {dayPosts.length > 3 && <p className="text-xs text-slate-400">{t('calendar.morePosts', { count: dayPosts.length - 3 })}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={!!selectedPost} onClose={() => setSelectedPost(null)} title={t('calendar.postDetails.title')} size="md"
        footer={selectedPost && <>
          <Button variant="outline" onClick={() => { setNewDate(selectedPost.scheduled_for ? selectedPost.scheduled_for.slice(0, 16) : ''); setShowReschedule(true); }}>{t('calendar.postDetails.reschedule')}</Button>
          <Button variant="outline" onClick={() => { onEdit(selectedPost); setSelectedPost(null); }}>{t('posts.action.edit')}</Button>
          <Button onClick={() => setSelectedPost(null)}>{t('calendar.postDetails.close')}</Button>
        </>}>
        {selectedPost && (
          <div className="space-y-3">
            {selectedPost.title && <p className="text-sm font-semibold text-slate-900 dark:text-white">{selectedPost.title}</p>}
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{selectedPost.content}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant={selectedPost.status === 'published' ? 'success' : selectedPost.status === 'failed' ? 'error' : 'info'}>{t(`post.status.${selectedPost.status}`)}</Badge>
              {selectedPost.platforms.map((p) => <Badge key={p}>{p}</Badge>)}
            </div>
            {selectedPost.scheduled_for && <p className="flex items-center gap-1.5 text-xs text-slate-500"><Clock className="h-3 w-3" /> {formatDateTime(selectedPost.scheduled_for)}</p>}
          </div>
        )}
      </Modal>

      <Modal open={showReschedule} onClose={() => setShowReschedule(false)} title={t('calendar.reschedule.title')} size="sm"
        footer={<><Button variant="outline" onClick={() => setShowReschedule(false)}>{t('common.cancel')}</Button><Button onClick={async () => {
          if (selectedPost && newDate) {
            const result = await update(selectedPost.id, { scheduled_for: new Date(newDate).toISOString(), status: 'scheduled' });
            if (!result) {
              push({ title: t('calendar.toast.qualityBlocked'), variant: 'error' });
              return;
            }
            push({ title: t('calendar.toast.rescheduled.title'), variant: 'success' });
            setShowReschedule(false);
            setSelectedPost(null);
          }
        }}>{t('common.save')}</Button></>}>
        <Input label={t('calendar.reschedule.dateLabel')} type="datetime-local" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
      </Modal>
    </div>
  );
}

function CalendarPost({ post, onClick }: { post: Post; onClick: () => void }) {
  const { t } = useLanguage();
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', post.id)} onClick={onClick} className={`cursor-move rounded-lg border p-3 ${statusColors[post.status] ?? statusColors.draft}`}>
      <div className="flex items-center justify-between">
        <Badge variant={post.status === 'published' ? 'success' : post.status === 'failed' ? 'error' : 'info'}>{t(`post.status.${post.status}`)}</Badge>
        <span className="text-xs text-slate-500">{post.scheduled_for ? formatDateTime(post.scheduled_for) : ''}</span>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-white">{post.title ?? t('calendar.untitled')}</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{post.content.slice(0, 100)}</p>
      <div className="mt-2 flex gap-1">{post.platforms.map((pl) => <span key={pl} className={`rounded px-1.5 py-0.5 text-[10px] ${platformColor(pl)}`}>{pl}</span>)}</div>
    </div>
  );
}

/** Recent activity from the publishing engine — manual publishes, the cron
 * scheduler picking up due scheduled posts, and automatic retries. */
function PublishingLogPanel() {
  const { t } = useLanguage();
  const { workspace } = useWorkspace();
  const [logs, setLogs] = useState<PublishingLog[]>([]);
  const [loading, setLoading] = useState(false);

  const logEventLabel: Record<PublishingLog['event'], string> = {
    queued: t('publishing.logEvent.queued'),
    attempt: t('publishing.logEvent.attempt'),
    success: t('publishing.logEvent.success'),
    failure: t('publishing.logEvent.failure'),
    retry_scheduled: t('publishing.logEvent.retryScheduled'),
    gave_up: t('publishing.logEvent.gaveUp'),
  };

  const logEventVariant: Record<PublishingLog['event'], 'default' | 'success' | 'error' | 'warning' | 'info'> = {
    queued: 'default',
    attempt: 'info',
    success: 'success',
    failure: 'error',
    retry_scheduled: 'warning',
    gave_up: 'error',
  };

  const load = async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      setLogs(await publishingLogRepository.list(workspace.id));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  if (!workspace) return null;

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('publishing.log.title')}</h2>
        <button onClick={load} disabled={loading} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title={t('publishing.log.refresh')}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {logs.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('publishing.log.empty')}</p>
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {logs.map((l) => (
            <div key={l.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 text-xs last:border-0 dark:border-slate-800">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={logEventVariant[l.event]}>{logEventLabel[l.event]}</Badge>
                  {l.platform && <span className="text-slate-500 dark:text-slate-400">{l.platform}</span>}
                </div>
                {l.message && <p className="mt-1 truncate text-slate-600 dark:text-slate-400" title={l.message}>{l.message}</p>}
              </div>
              <span className="shrink-0 text-slate-400 dark:text-slate-500">{formatDateTime(l.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
