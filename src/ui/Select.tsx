import { type SelectHTMLAttributes, forwardRef } from 'react';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, id, className = '', children, ...props }, ref) => {
    const selectId = id || props.name;
    return (
      <div className="w-full">
        {label && (
          <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 transition-[border-color,box-shadow] duration-150 ease-snappy focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-slate-900 dark:text-slate-100 ${
            error
              ? 'border-rose-400 focus:ring-rose-400 dark:border-rose-700'
              : 'border-slate-300 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-600'
          } ${className}`}
          {...props}
        >
          {children}
        </select>
        {error ? (
          <p className="mt-1 animate-slide-down text-xs text-rose-600 dark:text-rose-400">{error}</p>
        ) : hint ? (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
        ) : null}
      </div>
    );
  },
);
Select.displayName = 'Select';
