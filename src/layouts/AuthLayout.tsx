import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';

export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Left brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-slate-900 p-12 text-white lg:flex">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900" />
        <div className="absolute -end-24 -top-24 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute -bottom-24 -start-24 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="relative z-10 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
            <Sparkles className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold">SocialPilot AI</span>
        </div>
        <div className="relative z-10">
          <h1 className="text-3xl font-bold leading-tight">{t('authLayout.tagline')}</h1>
          <p className="mt-3 max-w-md text-slate-300">
            {t('authLayout.description')}
          </p>
        </div>
        <p className="relative z-10 text-sm text-slate-400">© {new Date().getFullYear()} SocialPilot AI</p>
      </div>
      {/* Right form panel */}
      <div className="flex w-full flex-col items-center justify-center gap-6 p-6 lg:w-1/2">
        <div className="w-full max-w-sm animate-slide-up">{children}</div>
        <p className="text-center text-xs text-slate-400 dark:text-slate-500">
          <Link to="/terms" className="hover:text-slate-600 dark:hover:text-slate-300">
            {t('legal.terms')}
          </Link>
          <span className="mx-2">·</span>
          <Link to="/privacy" className="hover:text-slate-600 dark:hover:text-slate-300">
            {t('legal.privacy')}
          </Link>
        </p>
      </div>
    </div>
  );
}
