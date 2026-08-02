import type { ReactNode } from 'react';
import { useLanguage } from '@/providers/LanguageProvider';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
};

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="mb-3 text-slate-300 dark:text-slate-600">{icon}</div>}
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
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
    <div className="flex flex-col items-center justify-center rounded-lg border border-rose-200 bg-rose-50 py-12 text-center dark:border-rose-900 dark:bg-rose-950/50">
      <h3 className="text-sm font-semibold text-rose-900 dark:text-rose-200">{title ?? t('common.error.title')}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-rose-700 dark:text-rose-300">{description}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-md border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-100 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-900"
        >
          {t('common.tryAgain')}
        </button>
      )}
    </div>
  );
}

export function SuccessAlert({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/50">
      <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">{title}</p>
      {description && <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">{description}</p>}
    </div>
  );
}
