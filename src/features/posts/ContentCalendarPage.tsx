import { useCallback, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { usePosts } from '@/hooks/usePosts';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, Card, Modal, Input } from '@/ui';
import { formatDateTime } from '@/utils/format';
import type { Post } from '@/types/social';

type ViewMode = 'month' | 'week' | 'day';

const platformColors: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  instagram: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  linkedin: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  linkedin_page: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
};

const statusColors: Record<string, string> = {
  draft: 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
  scheduled: 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950',
  publishing: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
  published: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
  failed: 'border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950',
  archived: 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
};

export function ContentCalendarPage() {
  const { t } = useLanguage();
  const { posts, update } = usePosts();
  const { push } = useToast();
  const [view, setView] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState('');

  const viewLabels: Record<ViewMode, string> = {
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
    await update(postId, { scheduled_for: newDate.toISOString(), status: 'scheduled' });
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('calendar.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('calendar.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800">
            {(['month', 'week', 'day'] as ViewMode[]).map((m) => (
              <button key={m} onClick={() => setView(m)} className={`px-3 py-1.5 text-xs font-medium transition ${view === m ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}`}>{viewLabels[m]}</button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => navigate(1)}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>{t('calendar.today')}</Button>
          </div>
        </div>
      </div>

      <p className="text-base font-semibold text-slate-900 dark:text-white sm:text-lg">{view === 'month' ? monthLabel : view === 'week' ? weekLabel : dayLabel}</p>

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
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
          <div className="grid min-w-[560px] grid-cols-7 gap-1 sm:min-w-0">
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
                  className={`min-h-[70px] rounded-lg border p-1.5 sm:min-h-[80px] ${isToday ? 'border-slate-400 dark:border-slate-500' : 'border-slate-200 dark:border-slate-800'} ${!isCurrentMonth ? 'opacity-40' : ''}`}
                >
                  <p className={`mb-1 text-xs font-medium ${isToday ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{d.getDate()}</p>
                  <div className="space-y-1">
                    {dayPosts.slice(0, 3).map((p) => (
                      <div key={p.id} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)} onClick={() => setSelectedPost(p)} className={`cursor-move rounded border px-1.5 py-1 text-xs ${statusColors[p.status] ?? statusColors.draft}`}>
                        <p className="truncate">{p.title ?? (p.content.slice(0, 30) || t('calendar.untitled'))}</p>
                        {p.platforms.slice(0, 2).map((pl) => <span key={pl} className={`mr-1 inline-block rounded px-1 text-[10px] ${platformColors[pl] ?? ''}`}>{pl.slice(0, 2)}</span>)}
                      </div>
                    ))}
                    {dayPosts.length > 3 && <p className="text-xs text-slate-400">{t('calendar.morePosts', { count: dayPosts.length - 3 })}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <Modal open={!!selectedPost} onClose={() => setSelectedPost(null)} title={t('calendar.postDetails.title')} size="md"
        footer={selectedPost && <>
          <Button variant="outline" onClick={() => { setNewDate(selectedPost.scheduled_for ? selectedPost.scheduled_for.slice(0, 16) : ''); setShowReschedule(true); }}>{t('calendar.postDetails.reschedule')}</Button>
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
          if (selectedPost && newDate) { await update(selectedPost.id, { scheduled_for: new Date(newDate).toISOString(), status: 'scheduled' }); push({ title: t('calendar.toast.rescheduled.title'), variant: 'success' }); setShowReschedule(false); setSelectedPost(null); }
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
      <div className="mt-2 flex gap-1">{post.platforms.map((pl) => <span key={pl} className={`rounded px-1.5 py-0.5 text-[10px] ${platformColors[pl] ?? ''}`}>{pl}</span>)}</div>
    </div>
  );
}
