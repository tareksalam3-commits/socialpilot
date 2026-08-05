import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff, CheckCheck, Loader2, Trash2 } from 'lucide-react';
import { useNotifications } from '@/hooks/useInbox';
import { useLanguage } from '@/providers/LanguageProvider';
import { timeAgo } from '@/utils/format';
import type { Notification } from '@/types/social';

const typeDot: Record<Notification['type'], string> = {
  publishing_success: 'bg-emerald-500',
  publishing_failure: 'bg-rose-500',
  ai_event: 'bg-amber-500',
  account_event: 'bg-sky-500',
  workspace_event: 'bg-slate-400',
  security_alert: 'bg-red-500',
};

const PREVIEW_COUNT = 8;

export function NotificationCenter() {
  const { t } = useLanguage();
  const { notifications, loading, unreadCount, markRead, markAllRead, deleteNotification } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const preview = notifications.slice(0, PREVIEW_COUNT);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        aria-label={t('notifications.title')}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[90vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('notifications.title')}</p>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
              >
                <CheckCheck className="h-3.5 w-3.5" /> {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : preview.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <BellOff className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('notifications.center.empty')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {preview.map((n) => (
                  <li
                    key={n.id}
                    className={`group relative flex items-start gap-2.5 px-4 py-3 transition ${
                      n.read ? '' : 'bg-slate-50 dark:bg-slate-800/50'
                    }`}
                  >
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : typeDot[n.type]}`} />
                    <button
                      onClick={() => {
                        if (!n.read) markRead(n.id);
                        setOpen(false);
                        navigate('/app/notifications');
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{n.title}</p>
                      {n.message && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{n.message}</p>}
                      <p className="mt-1 text-[11px] text-slate-400">{timeAgo(n.created_at, t)}</p>
                    </button>
                    <button
                      onClick={() => deleteNotification(n.id)}
                      className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition hover:bg-slate-100 hover:text-rose-500 group-hover:opacity-100 dark:hover:bg-slate-800"
                      aria-label={t('notifications.deleteAriaLabel')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            onClick={() => {
              setOpen(false);
              navigate('/app/notifications');
            }}
            className="block w-full border-t border-slate-100 px-4 py-2.5 text-center text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {t('notifications.viewAll')}
          </button>
        </div>
      )}
    </div>
  );
}
