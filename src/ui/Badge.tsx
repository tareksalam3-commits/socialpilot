import type { ReactNode } from 'react';

export type BadgeProps = {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  className?: string;
  /** Renders a small leading dot, useful for status badges. */
  dot?: boolean;
};

const variants = {
  default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  error: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
};

const dotVariants = {
  default: 'bg-slate-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
  info: 'bg-sky-500',
};

export function Badge({ children, variant = 'default', className = '', dot = false }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors duration-150 ${variants[variant]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotVariants[variant]}`} />}
      {children}
    </span>
  );
}
