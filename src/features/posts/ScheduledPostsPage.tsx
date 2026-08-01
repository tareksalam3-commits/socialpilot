import { useEffect, useState } from 'react';
import { CalendarClock, Copy, Edit2, FileText, Plus, RefreshCw, RotateCcw, Search, Send, Trash2 } from 'lucide-react';
import { usePosts } from '@/hooks/usePosts';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useToast } from '@/providers/ToastProvider';
import { publishingLogRepository } from '@/repositories/publishingLogRepository';
import { publishingService } from '@/services/publishingService';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, Table, TableRow, TableCell } from '@/ui';
import { formatDateTime } from '@/utils/format';
import type { Post, PostStatus, PublishingLog } from '@/types/social';

const statusOptions: PostStatus[] = ['draft', 'scheduled', 'publishing', 'published', 'failed', 'archived'];
const platformOptions = ['facebook', 'instagram', 'linkedin', 'linkedin_page'];

export function ScheduledPostsPage() {
  const { posts, loading, error, create, update, remove, duplicate, filterStatus, setFilterStatus, filterPlatform, setFilterPlatform, searchQuery, setSearchQuery } = usePosts();
  const { workspace } = useWorkspace();
  const { push } = useToast();
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<Post | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [form, setForm] = useState({ title: '', content: '', platforms: [] as string[], scheduled_for: '' });

  const handleNew = () => {
    setEditing(null);
    setForm({ title: '', content: '', platforms: [], scheduled_for: '' });
    setShowEditor(true);
  };

  const handleEdit = (post: Post) => {
    setEditing(post);
    setForm({
      title: post.title ?? '',
      content: post.content,
      platforms: post.platforms,
      scheduled_for: post.scheduled_for ? new Date(post.scheduled_for).toISOString().slice(0, 16) : '',
    });
    setShowEditor(true);
  };

  const handleSave = async () => {
    if (!form.content.trim()) {
      push({ title: 'Content is required', variant: 'error' });
      return;
    }
    if (editing) {
      await update(editing.id, {
        title: form.title || null,
        content: form.content,
        platforms: form.platforms,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
        status: form.scheduled_for ? 'scheduled' : 'draft',
      });
      push({ title: 'Post updated', variant: 'success' });
    } else {
      await create({
        title: form.title || undefined,
        content: form.content,
        platforms: form.platforms,
        scheduled_for: form.scheduled_for ? new Date(form.scheduled_for).toISOString() : null,
        status: form.scheduled_for ? 'scheduled' : 'draft',
      });
      push({ title: 'Post created', variant: 'success' });
    }
    setShowEditor(false);
  };

  const handlePublish = async (post: Post) => {
    if (!workspace) return;
    setPublishing(true);
    try {
      await publishingService.publishNow(post.id, workspace.id);
      push({ title: 'Post published', description: 'Your post has been sent to all platforms.', variant: 'success' });
    } catch (e) {
      push({ title: 'Publishing failed', description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setPublishing(false);
    }
  };

  const handleArchive = async (post: Post) => {
    await update(post.id, { status: 'archived' });
    push({ title: 'Post archived', variant: 'success' });
  };

  const handleRestore = async (post: Post) => {
    await update(post.id, { status: 'draft' });
    push({ title: 'Post restored', variant: 'success' });
  };

  const togglePlatform = (p: string) => {
    setForm((f) => ({ ...f, platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] }));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Posts</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Draft, schedule, publish, and manage your social posts.</p>
        </div>
        <Button onClick={handleNew}><Plus className="h-4 w-4" /> New Post</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="search" placeholder="Search posts…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
        </div>
        <select value={filterStatus ?? ''} onChange={(e) => setFilterStatus(e.target.value as PostStatus || null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <option value="">All statuses</option>
          {statusOptions.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>
        <select value={filterPlatform ?? ''} onChange={(e) => setFilterPlatform(e.target.value || null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
          <option value="">All platforms</option>
          {platformOptions.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {error ? (
        <ErrorState description={error} />
      ) : loading ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : posts.length === 0 ? (
        <Card><EmptyState icon={<CalendarClock className="h-10 w-10" />} title="No posts found" description="Create a new post to get started." action={<Button onClick={handleNew}><Plus className="h-4 w-4" /> Create post</Button>} /></Card>
      ) : (
        <Card>
          <Table headers={['Status', 'Content', 'Platforms', 'Scheduled', 'Actions']}>
            {posts.map((p) => (
              <TableRow key={p.id}>
                <TableCell><Badge variant={p.status === 'published' ? 'success' : p.status === 'scheduled' ? 'info' : p.status === 'failed' ? 'error' : p.status === 'archived' ? 'warning' : 'default'}>{p.status}</Badge></TableCell>
                <TableCell className="max-w-xs">
                  {p.title && <p className="text-xs font-medium text-slate-900 dark:text-white">{p.title}</p>}
                  <p className="truncate text-sm text-slate-600 dark:text-slate-400">{p.content || 'No content'}</p>
                </TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.platforms.length > 0 ? p.platforms.join(', ') : '—'}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.scheduled_for ? formatDateTime(p.scheduled_for) : '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {(p.status === 'draft' || p.status === 'failed') && (
                      <button onClick={() => handlePublish(p)} disabled={publishing} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800" title="Publish now"><Send className="h-3.5 w-3.5" /></button>
                    )}
                    <button onClick={() => handleEdit(p)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Edit"><Edit2 className="h-3.5 w-3.5" /></button>
                    <button onClick={() => duplicate(p.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Duplicate"><Copy className="h-3.5 w-3.5" /></button>
                    {p.status === 'archived' ? (
                      <button onClick={() => handleRestore(p)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Restore"><RotateCcw className="h-3.5 w-3.5" /></button>
                    ) : (
                      <button onClick={() => handleArchive(p)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Archive"><FileText className="h-3.5 w-3.5" /></button>
                    )}
                    <button onClick={() => remove(p.id)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-slate-800" title="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        </Card>
      )}

      <PublishingLogPanel />

      <Modal open={showEditor} onClose={() => setShowEditor(false)} title={editing ? 'Edit Post' : 'New Post'} size="lg"
        footer={<><Button variant="outline" onClick={() => setShowEditor(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Save' : 'Create'}</Button></>}>
        <div className="space-y-4">
          <Input label="Title (optional)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Post title" />
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Content</label>
            <textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} rows={5} placeholder="Write your post content…" className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Platforms</label>
            <div className="flex flex-wrap gap-2">
              {platformOptions.map((p) => (
                <button key={p} onClick={() => togglePlatform(p)} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${form.platforms.includes(p) ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-400'}`}>{p}</button>
              ))}
            </div>
          </div>
          <Input label="Schedule for (optional)" type="datetime-local" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}

const logEventLabel: Record<PublishingLog['event'], string> = {
  queued: 'Queued',
  attempt: 'Attempting',
  success: 'Published',
  failure: 'Failed',
  retry_scheduled: 'Retry scheduled',
  gave_up: 'Gave up',
};

const logEventVariant: Record<PublishingLog['event'], 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  queued: 'default',
  attempt: 'info',
  success: 'success',
  failure: 'error',
  retry_scheduled: 'warning',
  gave_up: 'error',
};

/** Recent activity from the publishing engine — manual publishes, the cron
 * scheduler picking up due scheduled posts, and automatic retries. */
function PublishingLogPanel() {
  const { workspace } = useWorkspace();
  const [logs, setLogs] = useState<PublishingLog[]>([]);
  const [loading, setLoading] = useState(false);

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
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Publishing Log</h2>
        <button onClick={load} disabled={loading} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {logs.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No publishing activity yet.</p>
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
