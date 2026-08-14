import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';
import { LANGUAGES } from '@/i18n/translations';

/**
 * Standalone, unauthenticated layout for legal/public pages (Terms of
 * Service, Privacy Policy). Deliberately does not read from AuthProvider or
 * any protected data source, so it renders the same for signed-in and
 * signed-out visitors — required for these pages to work as public URLs
 * (e.g. for TikTok's app review) without a login redirect.
 */
export function LegalLayout({ children }: { children: ReactNode }) {
  const { language, setLanguage, dir } = useLanguage();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">SocialPilot AI</span>
          </Link>
          <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
            {LANGUAGES.map((l) => (
              <button
                key={l.code}
                onClick={() => setLanguage(l.code)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  language === l.code
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {l.nativeLabel}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">{children}</main>

      <footer className="border-t border-slate-200 py-8 dark:border-slate-800">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-6 text-xs text-slate-400 dark:text-slate-500">
          <span>© {new Date().getFullYear()} SocialPilot AI</span>
          <div className="flex items-center gap-4">
            <Link to="/terms" className="hover:text-slate-600 dark:hover:text-slate-300">
              {dir === 'rtl' ? 'شروط الخدمة' : 'Terms of Service'}
            </Link>
            <Link to="/privacy" className="hover:text-slate-600 dark:hover:text-slate-300">
              {dir === 'rtl' ? 'سياسة الخصوصية' : 'Privacy Policy'}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
