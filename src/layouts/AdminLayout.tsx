import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Bot,
  CreditCard,
  KeyRound,
  Layers,
  LogOut,
  Menu,
  Plug,
  Receipt,
  Settings as SettingsIcon,
  ShieldCheck,
  Users as UsersIcon,
  Wallet,
  X as XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/providers/AuthProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { initials } from '@/utils/format';
import { Dropdown, DropdownItem } from '@/ui';

const adminNavSections = [
  {
    labelKey: 'admin.nav.section.overview',
    items: [
      { to: '/admin', end: true, labelKey: 'admin.nav.dashboard', icon: BarChart3 },
      { to: '/admin/analytics', labelKey: 'admin.nav.analytics', icon: Activity },
      { to: '/admin/audit-logs', labelKey: 'admin.nav.auditLogs', icon: ShieldCheck },
    ],
  },
  {
    labelKey: 'admin.nav.section.accounts',
    items: [
      { to: '/admin/users', labelKey: 'admin.nav.users', icon: UsersIcon },
      { to: '/admin/workspaces', labelKey: 'admin.nav.workspaces', icon: Layers },
    ],
  },
  {
    labelKey: 'admin.nav.section.billing',
    items: [
      { to: '/admin/subscriptions', labelKey: 'admin.nav.subscriptions', icon: Wallet },
      { to: '/admin/plans', labelKey: 'admin.nav.plans', icon: CreditCard },
      { to: '/admin/payments', labelKey: 'admin.nav.payments', icon: Receipt },
      { to: '/admin/ai-credits', labelKey: 'admin.nav.aiCredits', icon: Bot },
    ],
  },
  {
    labelKey: 'admin.nav.section.platform',
    items: [
      { to: '/admin/ai-providers', labelKey: 'admin.nav.aiProviders', icon: KeyRound },
      { to: '/admin/integrations', labelKey: 'admin.nav.integrations', icon: Plug },
      { to: '/admin/settings', labelKey: 'admin.nav.settings', icon: SettingsIcon },
    ],
  },
];

export function AdminLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);
  const { user, profile, signOut } = useAuth();
  const { t, dir } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

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
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-800 px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500 text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{t('admin.panelName')}</span>
            <span className="block truncate text-[11px] text-slate-400">{t('admin.panelSubtitle')}</span>
          </div>
        </div>
        <button
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1 text-slate-400 transition hover:bg-slate-800 hover:text-slate-200 lg:hidden"
          aria-label={t('sidebar.closeMenu')}
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto p-2">
        {adminNavSections.map((section) => (
          <div key={section.labelKey}>
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{t(section.labelKey)}</p>
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={'end' in item ? item.end : false}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ${
                      isActive ? 'bg-indigo-500/15 text-indigo-300' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute inset-y-1 start-0 w-0.5 rounded-full bg-indigo-400" />}
                      <item.icon className="h-4 w-4 shrink-0 transition-transform duration-150 group-hover:scale-110" />
                      <span>{t(item.labelKey)}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-800 p-2">
        <Dropdown
          direction="up"
          trigger={
            <div className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors duration-150 hover:bg-slate-800">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-300">
                {initials(profile?.full_name ?? user?.email)}
              </div>
              <div className="flex-1 overflow-hidden text-start">
                <p className="truncate text-sm font-medium text-white">{profile?.full_name ?? 'Super Admin'}</p>
                <p className="truncate text-xs text-slate-400">{user?.email}</p>
              </div>
            </div>
          }
        >
          <DropdownItem onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> {t('common.signOut')}
          </DropdownItem>
        </Dropdown>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <aside className="hidden w-64 flex-col border-r border-slate-800 bg-slate-900 lg:flex">{sidebarContent}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className={`absolute inset-0 bg-slate-950/70 transition-opacity duration-200 ${drawerVisible ? 'opacity-100' : 'opacity-0'}`}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className={`relative flex h-full w-72 max-w-[85vw] flex-col bg-slate-900 shadow-popover transition-transform duration-250 ease-smooth ${
              drawerVisible ? 'translate-x-0' : dir === 'rtl' ? 'translate-x-full' : '-translate-x-full'
            }`}
          >
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/90 px-4 backdrop-blur sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="press-effect rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 lg:hidden"
              aria-label={t('sidebar.openMenu')}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{t('admin.panelName')}</p>
              <p className="hidden truncate text-xs text-slate-400 sm:block">{t('admin.panelSubtitle')}</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            {t('admin.superAdminBadge')}
          </span>
        </header>
        <main ref={scrollRef} className="flex-1 overflow-y-auto bg-slate-950 p-4 sm:p-6">
          <div key={location.pathname} className="page-transition">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
