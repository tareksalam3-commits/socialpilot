import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useNotifications } from '@/hooks/useInbox';
import {
  BarChart3,
  Bell as BellIcon,
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
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
import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { initials } from '@/utils/format';
import { Dropdown, DropdownItem } from '@/ui';

const navSections = [
  {
    label: 'Overview',
    items: [
      { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/app/analytics', label: 'Analytics', icon: BarChart3 },
      { to: '/app/search', label: 'Search', icon: SearchIcon },
    ],
  },
  {
    label: 'Publishing',
    items: [
      { to: '/app/accounts', label: 'Accounts', icon: Link2 },
      { to: '/app/scheduled', label: 'Posts', icon: CalendarClock },
      { to: '/app/calendar', label: 'Calendar', icon: CalendarDays },
      { to: '/app/media', label: 'Media Library', icon: ImageIcon },
      { to: '/app/inbox', label: 'Inbox', icon: InboxIcon },
    ],
  },
  {
    label: 'AI Studio',
    items: [
      { to: '/app/playground', label: 'Playground', icon: MessageSquare },
      { to: '/app/studio', label: 'Content Studio', icon: Wand2 },
      { to: '/app/prompts', label: 'Prompts', icon: Library },
      { to: '/app/ai-history', label: 'AI History', icon: History },
      { to: '/app/token-analytics', label: 'Token Analytics', icon: ZapIcon },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/app/workspace', label: 'Workspace', icon: Users },
      { to: '/app/notifications', label: 'Notifications', icon: BellIcon },
      { to: '/app/brand-voice', label: 'Brand Voice', icon: Sparkles },
      { to: '/app/ai-settings', label: 'AI Settings', icon: Settings },
      { to: '/app/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function AppLayout({ children }: { children?: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, profile, signOut } = useAuth();
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const sidebarContent = (
    <>
      <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4 dark:border-slate-800">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
            <Sparkles className="h-4 w-4" />
          </div>
          {!collapsed && <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">SocialPilot AI</span>}
        </div>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="hidden rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 lg:block"
          aria-label="Toggle sidebar"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <button
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 lg:hidden"
          aria-label="Close menu"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-2">
        {navSections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {section.label}
              </p>
            )}
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                    }`
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-2 dark:border-slate-800">
        <Dropdown
          trigger={
            <div className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-slate-100 dark:hover:bg-slate-800">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {initials(profile?.full_name ?? user?.email)}
              </div>
              {!collapsed && (
                <div className="flex-1 overflow-hidden text-left">
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
              {workspace?.name ?? 'No workspace'}
            </p>
          </div>
          <div className="border-t border-slate-100 dark:border-slate-800" />
          <DropdownItem onClick={() => navigate('/app/settings')}>
            <Settings className="h-4 w-4" /> Settings
          </DropdownItem>
          <DropdownItem onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> Sign out
          </DropdownItem>
        </Dropdown>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Desktop sidebar */}
      <aside
        className={`hidden flex-col border-r border-slate-200 bg-white transition-all duration-200 dark:border-slate-800 dark:bg-slate-900 lg:flex ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-white dark:bg-slate-900">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                {workspace?.name ?? 'Your Workspace'}
              </p>
              <p className="hidden truncate text-xs text-slate-500 dark:text-slate-400 sm:block">
                {workspace?.brand_name ?? 'Set up your brand in Settings'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <NotificationBell />
            <div className="hidden text-right md:block">
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
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">{children ?? <Outlet />}</main>
      </div>
    </div>
  );
}

function NotificationBell() {
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate('/app/notifications')} className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="Notifications">
      <BellIcon className="h-5 w-5" />
      {unreadCount > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
    </button>
  );
}
