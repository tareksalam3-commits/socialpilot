import { useLanguage } from '@/providers/LanguageProvider';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-5 w-5 animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function LoadingScreen({ label }: { label?: string }) {
  const { t } = useLanguage();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-slate-500 animate-fade-in dark:text-slate-400">
      <Spinner className="h-8 w-8 text-slate-400" />
      <p className="text-sm">{label ?? t('common.loading')}</p>
    </div>
  );
}

/**
 * Thin indeterminate progress bar for the top of the viewport, used while a
 * lazy-loaded route chunk is being fetched. Keeps navigation feeling instant
 * instead of a blank screen while the async import resolves.
 */
export function TopProgressBar() {
  return (
    <div className="fixed inset-x-0 top-0 z-[200] h-0.5 overflow-hidden bg-transparent">
      <div className="h-full w-1/3 animate-[indeterminate_1.1s_ease-in-out_infinite] rounded-full bg-slate-900 dark:bg-white" />
      <style>{`
        @keyframes indeterminate {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(120%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </div>
  );
}

export function InlineLoading({ label, className = '' }: { label?: string; className?: string }) {
  const { t } = useLanguage();
  return (
    <div className={`flex items-center justify-center gap-2 py-8 text-slate-400 animate-fade-in dark:text-slate-500 ${className}`}>
      <Spinner className="h-4 w-4" />
      <span className="text-sm">{label ?? t('common.loading')}</span>
    </div>
  );
}
