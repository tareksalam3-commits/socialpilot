import { useMemo, useState } from 'react';
import { Bell, CheckCheck, BellOff, Loader2, Trash2 } from 'lucide-react';
import { useNotifications } from '@/hooks/useInbox';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, Card, EmptyState } from '@/ui';
import { timeAgo } from '@/utils/format';
import type { Notification } from '@/types/social';

const typeColors: Record<Notification['type'], string> = {
  publishing_success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  publishing_failure: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  ai_event: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  account_event: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  workspace_event: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  security_alert: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

const typeLabelKeys: Record<Notification['type'], string> = {
  publishing_success: 'notifications.type.publishing',
  publishing_failure: 'notifications.type.publishing',
  ai_event: 'notifications.type.ai',
  account_event: 'notifications.type.account',
  workspace_event: 'notifications.type.workspace',
  security_alert: 'notifications.type.security',
};

const typeFilterValues: ('all' | Notification['type'])[] = [
  'all',
  'publishing_success',
  'publishing_failure',
  'ai_event',
  'security_alert',
  'workspace_event',
  'account_event',
];

const typeFilterLabelKeys: Record<string, string> = {
  all: 'notifications.filter.all',
  publishing_success: 'notifications.filter.publishingSuccess',
  publishing_failure: 'notifications.filter.publishingFailed',
  ai_event: 'notifications.filter.aiEvents',
  security_alert: 'notifications.filter.security',
  workspace_event: 'notifications.filter.workspace',
  account_event: 'notifications.filter.account',
};

export function NotificationsPage() {
  const { notifications, loading, loadingMore, hasMore, unreadCount, markRead, markAllRead, deleteNotification, loadMore } =
    useNotifications();
  const { t } = useLanguage();
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | Notification['type']>('all');

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (readFilter === 'unread' && n.read) return false;
      if (typeFilter !== 'all' && n.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, readFilter, typeFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('notifications.page.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {unreadCount > 0 ? t('notifications.page.unreadCount', { count: unreadCount }) : t('notifications.page.allCaughtUp')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800">
            <button
              onClick={() => setReadFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium ${readFilter === 'all' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}`}
            >
              {t('notifications.page.all')}
            </button>
            <button
              onClick={() => setReadFilter('unread')}
              className={`px-3 py-1.5 text-xs font-medium ${readFilter === 'unread' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'text-slate-600 dark:text-slate-400'}`}
            >
              {t('notifications.page.unread')}
            </button>
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllRead}>
              <CheckCheck className="h-4 w-4" /> {t('notifications.center.markAllRead')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {typeFilterValues.map((v) => (
          <button
            key={v}
            onClick={() => setTypeFilter(v)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              typeFilter === v
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            {t(typeFilterLabelKeys[v])}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-slate-500">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BellOff className="h-10 w-10" />}
            title={readFilter === 'unread' ? t('notifications.page.noUnread') : t('notifications.page.none')}
            description={t('notifications.page.emptyDescription')}
          />
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {filtered.map((n) => {
              const color = typeColors[n.type];
              return (
                <div
                  key={n.id}
                  className={`group flex items-start gap-3 rounded-xl border p-4 transition ${
                    n.read ? 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900' : 'border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50'
                  }`}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}>
                    <Bell className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</p>
                      <Badge variant="default">{t(typeLabelKeys[n.type])}</Badge>
                      {!n.read && <span className="h-2 w-2 rounded-full bg-sky-500" />}
                    </div>
                    {n.message && <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{n.message}</p>}
                    <p className="mt-1 text-xs text-slate-400">{timeAgo(n.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {!n.read && (
                      <button onClick={() => markRead(n.id)} className="text-xs text-sky-600 hover:underline dark:text-sky-400">
                        {t('notifications.page.markRead')}
                      </button>
                    )}
                    <button
                      onClick={() => deleteNotification(n.id)}
                      className="rounded p-1 text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-slate-800"
                      aria-label={t('notifications.center.deleteAria')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && typeFilter === 'all' && readFilter === 'all' && (
            <div className="flex justify-center pt-2">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore ? t('common.loading') : t('notifications.page.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
