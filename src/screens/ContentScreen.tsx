import { useEffect, useState } from 'react';
import { FileText, Calendar as CalendarIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Card, ScreenLoader, EmptyState, Badge } from '@/components/ui';
import { PLATFORM_META } from '@/lib/constants';
import type { Content, CalendarItem, ContentStatus } from '@/lib/types';

type View = 'list' | 'calendar';

const STATUS_LABELS: Record<ContentStatus, string> = {
  idea: 'فكرة',
  draft: 'مسودة',
  review: 'مراجعة',
  approved: 'موافق عليه',
  scheduled: 'مجدول',
  published: 'منشور',
  rejected: 'مرفوض',
};

const STATUS_COLORS: Record<ContentStatus, 'neutral' | 'brand' | 'warning' | 'accent' | 'danger'> = {
  idea: 'neutral',
  draft: 'neutral',
  review: 'warning',
  approved: 'brand',
  scheduled: 'accent',
  published: 'brand',
  rejected: 'danger',
};

export function ContentScreen() {
  const { workspace } = useAuth();
  const [view, setView] = useState<View>('list');
  const [content, setContent] = useState<Content[]>([]);
  const [calendar, setCalendar] = useState<CalendarItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    if (!workspace) return;
    (async () => {
      const [c, cal] = await Promise.all([
        supabase
          .from('content')
          .select('*')
          .eq('workspace_id', workspace.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('calendar_items')
          .select('*')
          .eq('workspace_id', workspace.id)
          .order('scheduled_for', { ascending: true }),
      ]);
      setContent((c.data as Content[]) ?? []);
      setCalendar((cal.data as CalendarItem[]) ?? []);
      setLoading(false);
    })();
  }, [workspace]);

  if (loading) return <ScreenLoader />;

  return (
    <div className="px-5 py-6 safe-top">
      {/* Tab toggle */}
      <div className="flex bg-ink-900 rounded-xl p-1 mb-5">
        <button
          onClick={() => setView('list')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm transition-all ${
            view === 'list' ? 'bg-ink-700 text-ink-50' : 'text-ink-400'
          }`}
        >
          <FileText size={16} /> المحتوى
        </button>
        <button
          onClick={() => setView('calendar')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm transition-all ${
            view === 'calendar' ? 'bg-ink-700 text-ink-50' : 'text-ink-400'
          }`}
        >
          <CalendarIcon size={16} /> التقويم
        </button>
      </div>

      {view === 'list' ? (
        content.length === 0 ? (
          <EmptyState
            icon={<FileText size={28} />}
            title="لا يوجد محتوى بعد"
            subtitle="استخدم تبويب إنشاء واكتب للـ AI ما تريد"
          />
        ) : (
          <div className="flex flex-col gap-2">
            {content.map((c) => (
              <Card key={c.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-ink-100 text-sm font-medium truncate">{c.title}</p>
                    {c.topic && <p className="text-ink-500 text-xs mt-1 truncate">{c.topic}</p>}
                    <div className="flex items-center gap-2 mt-2">
                      <Badge color={STATUS_COLORS[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                      {c.platforms.length > 0 && (
                        <span className="text-ink-600 text-xs">{c.platforms.join('، ')}</span>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <CalendarView items={calendar} weekOffset={weekOffset} setWeekOffset={setWeekOffset} />
      )}
    </div>
  );
}

function CalendarView({
  items,
  weekOffset,
  setWeekOffset,
}: {
  items: CalendarItem[];
  weekOffset: number;
  setWeekOffset: (n: number) => void;
}) {
  const today = new Date();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7);
  startOfWeek.setHours(0, 0, 0, 0);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function itemsForDay(day: Date): CalendarItem[] {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);
    return items.filter((item) => {
      const d = new Date(item.scheduled_for);
      return d >= start && d <= end;
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setWeekOffset(weekOffset - 1)}
          className="p-2 rounded-lg bg-ink-900 text-ink-300 active:scale-95"
        >
          <ChevronRight size={18} />
        </button>
        <p className="text-ink-200 text-sm font-medium">
          {weekOffset === 0 ? 'هذا الأسبوع' : weekOffset === 1 ? 'الأسبوع القادم' : weekOffset === -1 ? 'الأسبوع الماضي' : `أسبوع ${weekOffset > 0 ? '+' : ''}${weekOffset}`}
        </p>
        <button
          onClick={() => setWeekOffset(weekOffset + 1)}
          className="p-2 rounded-lg bg-ink-900 text-ink-300 active:scale-95"
        >
          <ChevronLeft size={18} />
        </button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<CalendarIcon size={28} />}
          title="التقويم فارغ"
          subtitle="المحتوى المجدول سيظهر هنا"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {days.map((day, i) => {
            const dayItems = itemsForDay(day);
            if (dayItems.length === 0) return null;
            return (
              <div key={i}>
                <p className="text-ink-400 text-xs mb-2">
                  {dayNames[day.getDay()]} — {day.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}
                </p>
                <div className="flex flex-col gap-2">
                  {dayItems.map((item) => {
                    const meta = PLATFORM_META[item.platform as keyof typeof PLATFORM_META];
                    const Icon = meta?.icon;
                    return (
                      <Card key={item.id}>
                        <div className="flex items-center gap-3">
                          {Icon && <Icon size={18} style={{ color: meta.color }} />}
                          <div className="flex-1">
                            <p className="text-ink-100 text-sm">{new Date(item.scheduled_for).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</p>
                            <Badge color={item.status === 'published' ? 'brand' : item.status === 'failed' ? 'danger' : 'neutral'}>
                              {item.status}
                            </Badge>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
