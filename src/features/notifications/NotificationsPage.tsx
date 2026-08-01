import { useState } from 'react';
import { Bell, CheckCheck, BellOff } from 'lucide-react';
import { useNotifications } from '@/hooks/useInbox';
import { Badge, Button, Card, EmptyState } from '@/ui';
import { timeAgo } from '@/utils/format';
import type { Notification } from '@/types/social';

const typeConfig: Record<Notification['type'], { color: string; label: string }> = {
  publishing_success: { color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', label: 'Publishing' },
  publishing_failure: { color: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300', label: 'Publishing' },
  ai_event: { color: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', label: 'AI' },
  account_event: { color: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300', label: 'Account' },
  workspace_event: { color: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', label: 'Workspace' },
  security_alert: { color: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300', label: 'Security' },
};

export function NotificationsPage() {
  const { notifications, loading, unreadCount, markRead, markAllRead } = useNotifications();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800">
            <button onClick={() => setFilter('all')} className={`px-3 py-1.5 text-xs font-medium ${filter === 'all' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}`}>All</button>
            <button onClick={() => setFilter('unread')} className={`px-3 py-1.5 text-xs font-medium ${filter === 'unread' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}`}>Unread</button>
          </div>
          {unreadCount > 0 && <Button variant="outline" size="sm" onClick={markAllRead}><CheckCheck className="h-4 w-4" /> Mark all read</Button>}
        </div>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card><EmptyState icon={<BellOff className="h-10 w-10" />} title={filter === 'unread' ? 'No unread notifications' : 'No notifications'} description="You'll see publishing results, AI events, and account alerts here." /></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((n) => {
            const cfg = typeConfig[n.type];
            return (
              <div key={n.id} className={`flex items-start gap-3 rounded-xl border p-4 transition ${n.read ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900' : 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'}`}>
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${cfg.color}`}><Bell className="h-4 w-4" /></div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</p>
                    <Badge variant="default">{cfg.label}</Badge>
                    {!n.read && <span className="h-2 w-2 rounded-full bg-sky-500" />}
                  </div>
                  {n.message && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{n.message}</p>}
                  <p className="mt-1 text-xs text-slate-400">{timeAgo(n.created_at)}</p>
                </div>
                {!n.read && <button onClick={() => markRead(n.id)} className="text-xs text-sky-600 hover:underline dark:text-sky-400">Mark read</button>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
