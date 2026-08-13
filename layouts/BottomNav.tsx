import { NavLink } from 'react-router-dom';
import { Bot, CalendarClock, Inbox as InboxIcon, Menu, Bell as BellIcon } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';
import { useNotifications } from '@/hooks/useInbox';
import { haptic } from '@/utils/haptics';
import { preloadByPath } from '@/routes/lazyPages';

const tabs = [
  { to: '/app/assistant', labelKey: 'nav.assistant', icon: Bot },
  { to: '/app/playground', labelKey: 'nav.playground', icon: CalendarClock },
  { to: '/app/inbox', labelKey: 'nav.inbox', icon: InboxIcon },
  { to: '/app/notifications', labelKey: 'nav.notifications', icon: BellIcon },
] as const;

/**
 * Fixed bottom tab bar shown only on small screens (lg:hidden), styled and
 * behaved like the primary nav in Facebook/Instagram-class apps: persistent
 * across every /app/* route, safe-area aware, with a haptic tick per tap and
 * a "More" tab that opens the full drawer for everything else.
 */
export function BottomNav({ onOpenMore }: { onOpenMore: () => void }) {
  const { t } = useLanguage();
  const { unreadCount } = useNotifications();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-slate-200 bg-white/95 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      role="navigation"
      aria-label={t('nav.mobileTabBar')}
    >
      {tabs.map((tabItem) => (
        <NavLink
          key={tabItem.to}
          to={tabItem.to}
          onMouseDown={() => preloadByPath[tabItem.to]?.()}
          onClick={() => haptic('selection')}
          className={({ isActive }) =>
            `no-callout relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 press-effect ${
              isActive ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'
            }`
          }
        >
          {({ isActive }) => (
            <>
              <span className="relative">
                <tabItem.icon className={`h-5 w-5 transition-transform ${isActive ? 'scale-110' : ''}`} strokeWidth={isActive ? 2.4 : 2} />
                {tabItem.to === '/app/notifications' && unreadCount > 0 && (
                  <span className="absolute -end-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-rose-500 px-0.5 text-[9px] font-bold text-white">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium leading-none">{t(tabItem.labelKey)}</span>
              {isActive && <span className="absolute -top-px h-0.5 w-8 rounded-full bg-slate-900 dark:bg-white" />}
            </>
          )}
        </NavLink>
      ))}
      <button
        onClick={() => {
          haptic('selection');
          onOpenMore();
        }}
        className="no-callout flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-slate-400 press-effect dark:text-slate-500"
      >
        <Menu className="h-5 w-5" />
        <span className="text-[10px] font-medium leading-none">{t('nav.more')}</span>
      </button>
    </nav>
  );
}
