import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex animate-fade-in flex-col items-center justify-center px-6 py-14 text-center ${className}`}>
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
};

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  const { t } = useLanguage();
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center rounded-xl border border-rose-200 bg-rose-50/70 px-6 py-14 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-100 text-rose-500 dark:bg-rose-950 dark:text-rose-400">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="text-sm font-semibold text-rose-900 dark:text-rose-200">{title ?? t('common.error.title')}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-rose-700 dark:text-rose-300">{description}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="press-effect mt-5 rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-700 shadow-subtle transition-colors hover:bg-rose-100 dark:border-rose-800 dark:bg-transparent dark:text-rose-300 dark:hover:bg-rose-900"
        >
          {t('common.tryAgain')}
        </button>
      )}
    </div>
  );
}

export function SuccessAlert({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex animate-slide-down items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/50">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      <div>
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{title}</p>
        {description && <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">{description}</p>}
      </div>
    </div>
  );
}
