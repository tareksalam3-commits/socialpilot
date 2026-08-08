import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { NotificationCenter } from '@/features/notifications/NotificationCenter';
import {
  BarChart3,
  Bell as BellIcon,
  Bot,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Database,
  History,
  Image as ImageIcon,
  Inbox as InboxIcon,
  LayoutDashboard,
  Library,
  Link2,
  LogOut,
  Menu,
  MessageSquare,
  Search as SearchIcon,
  Settings,
  Sparkles,
  Users,
  Wand2,
  X as XIcon,
  Zap as ZapIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useLanguage } from '@/providers/LanguageProvider';
import { initials } from '@/utils/format';
import { Dropdown, DropdownItem } from '@/ui';
import { preloadByPath } from '@/routes/lazyPages';

const navSections = [
  {
    labelKey: 'nav.section.overview',
    items: [
      { to: '/app/assistant', labelKey: 'nav.assistant', icon: Bot },
      { to: '/app/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
      { to: '/app/analytics', labelKey: 'nav.analytics', icon: BarChart3 },
      { to: '/app/search', labelKey: 'nav.search', icon: SearchIcon },
    ],
  },
  {
    labelKey: 'nav.section.publishing',
    items: [
      { to: '/app/accounts', labelKey: 'nav.accounts', icon: Link2 },
      { to: '/app/scheduled', labelKey: 'nav.posts', icon: CalendarClock },
      { to: '/app/calendar', labelKey: 'nav.calendar', icon: CalendarDays },
      { to: '/app/media', labelKey: 'nav.mediaLibrary', icon: ImageIcon },
      { to: '/app/inbox', labelKey: 'nav.inbox', icon: InboxIcon },
      { to: '/app/automation', labelKey: 'nav.automation', icon: Bot },
    ],
  },
  {
    labelKey: 'nav.section.aiStudio',
    items: [
      { to: '/app/playground', labelKey: 'nav.playground', icon: MessageSquare },
      { to: '/app/studio', labelKey: 'nav.contentStudio', icon: Wand2 },
      { to: '/app/content-sources', labelKey: 'nav.contentSources', icon: Database },
      { to: '/app/prompts', labelKey: 'nav.prompts', icon: Library },
      { to: '/app/ai-history', labelKey: 'nav.aiHistory', icon: History },
      { to: '/app/token-analytics', labelKey: 'nav.tokenAnalytics', icon: ZapIcon },
    ],
  },
  {
    labelKey: 'nav.section.settings',
    items: [
      { to: '/app/workspace', labelKey: 'nav.workspace', icon: Users },
      { to: '/app/notifications', labelKey: 'nav.notifications', icon: BellIcon },
      { to: '/app/brand-voice', labelKey: 'nav.brandVoice', icon: Sparkles },
      { to: '/app/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
];

// Warms a route's JS chunk the moment the pointer/focus lands on its nav
// link, so the click that follows resolves near-instantly instead of
// waiting on a fresh network fetch.
const prefetchedPaths = new Set<string>();
function prefetch(to: string) {
  if (prefetchedPaths.has(to)) return;
  const loader = preloadByPath[to];
  if (!loader) return;
  prefetchedPaths.add(to);
  loader().catch(() => {
    prefetchedPaths.delete(to);
  });
}

export function AppLayout({ children }: { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const { user, profile, signOut } = useAuth();
  const { workspace, ensureWorkspace, loading: wsLoading } = useWorkspace();
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLElement>(null);

  // Ensure every signed-in user has a workspace, no matter which /app/*
  // page they land on first — previously this only ran on Dashboard/Accounts,
  // so visiting any other page first (Brand Voice, Automation, Settings...)
  // left `workspace` permanently null and those pages stuck loading forever.
  useEffect(() => {
    if (!wsLoading && !workspace && user) {
      ensureWorkspace();
    }
  }, [wsLoading, workspace, user, ensureWorkspace]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Scroll the content area back to the top on every navigation, and reset
  // it synchronously (no smooth-scroll) so the incoming page never flashes
  // mid-scroll before jumping up.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  // Mount/unmount the drawer with a frame of delay so the slide-in
  // transition has something to animate from (display:none -> flex would
  // otherwise skip straight to the end state).
  useEffect(() => {
    if (mobileOpen) {
      const raf = requestAnimationFrame(() => setDrawerVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setDrawerVisible(false);
  }, [mobileOpen]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const sidebarContent = (
    <>
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
            <Sparkles className="h-4 w-4" />
          </div>
          {!collapsed && <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">SocialPilot AI</span>}
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="hidden rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 lg:block"
          aria-label={t('sidebar.toggle')}
        >
          {(collapsed && dir === 'ltr') || (!collapsed && dir === 'rtl') ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 lg:hidden"
          aria-label={t('sidebar.closeMenu')}
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-2">
        {navSections.map((section) => (
          <div key={section.labelKey}>
            {!collapsed && (
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {t(section.labelKey)}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onMouseEnter={() => prefetch(item.to)}
                  onFocus={() => prefetch(item.to)}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                      isActive
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                    }`
                  }
                  title={collapsed ? t(item.labelKey) : undefined}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute inset-y-1 start-0 w-0.5 rounded-full bg-slate-900 dark:bg-white" />
                      )}
                      <item.icon className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-110" />
                      {!collapsed && <span>{t(item.labelKey)}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        <Dropdown
          direction="up"
          trigger={
            <div className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-slate-100 dark:hover:bg-slate-800">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {initials(profile?.full_name ?? user?.email)}
              </div>
              {!collapsed && (
                <div className="flex-1 overflow-hidden text-start">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">
                    {profile?.full_name ?? 'User'}
                  </p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
                </div>
              )}
            </div>
          }
        >
          <div className="px-3 py-2">
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {workspace?.name ?? t('layout.noWorkspace')}
            </p>
          </div>
          <div className="border-t border-slate-100 dark:border-slate-800" />
          <DropdownItem onClick={() => navigate('/app/settings')}>
            <Settings className="h-4 w-4" /> {t('nav.settings')}
          </DropdownItem>
          <DropdownItem onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> {t('common.signOut')}
          </DropdownItem>
        </Dropdown>
        {!collapsed && (
          <p className="mt-1.5 px-2 text-center text-[11px] text-slate-400 dark:text-slate-600">
            <Link to="/terms" className="hover:text-slate-600 dark:hover:text-slate-300">
              {t('legal.terms')}
            </Link>
            <span className="mx-1.5">·</span>
            <Link to="/privacy" className="hover:text-slate-600 dark:hover:text-slate-300">
              {t('legal.privacy')}
            </Link>
          </p>
        )}
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-col border-r border-slate-200 bg-white transition-[width] duration-250 ease-smooth dark:border-slate-800 dark:bg-slate-900 lg:flex ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className={`absolute inset-0 bg-slate-900/50 transition-opacity duration-200 ${drawerVisible ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className={`relative flex h-full w-72 max-w-[85vw] flex-col bg-white shadow-popover transition-transform duration-250 ease-smooth dark:bg-slate-900 ${
              drawerVisible
                ? 'translate-x-0'
                : dir === 'rtl'
                  ? 'translate-x-full'
                  : '-translate-x-full'
            }`}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="press-effect rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 lg:hidden"
              aria-label={t('sidebar.openMenu')}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {workspace?.name ?? t('layout.yourWorkspace')}
              </p>
              <p className="hidden truncate text-xs text-slate-500 dark:text-slate-400 sm:block">
                {workspace?.brand_name ?? t('layout.setUpBrand')}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <NotificationCenter />
            <div className="hidden text-end md:block">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                {profile?.full_name ?? 'User'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{user?.email}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {initials(profile?.full_name ?? user?.email)}
            </div>
          </div>
        </header>
        <main ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Keying on the pathname replays the fade/slide-up animation on every route change */}
          <div key={location.pathname} className="page-transition">
            {children ?? <Outlet />}
          </div>
        </main>
      </div>
    </div>
  );
}
