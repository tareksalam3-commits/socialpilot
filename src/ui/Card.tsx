import type { HTMLAttributes, ReactNode } from 'react';

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  action?: ReactNode;
  /** Adds a subtle lift + shadow on hover, for cards that act as clickable tiles. */
  interactive?: boolean;
};

export function Card({
  title,
  description,
  action,
  interactive = false,
  className = '',
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-subtle transition-shadow duration-200 ease-smooth dark:border-slate-800 dark:bg-slate-900 ${
        interactive ? 'hover:-translate-y-0.5 hover:shadow-card-hover' : ''
      } ${interactive ? 'transition-transform' : ''} ${className}`}
      {...props}
    >
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            {title && <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>}
            {description && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}
