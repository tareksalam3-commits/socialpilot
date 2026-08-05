import type { ReactNode } from 'react';

export type TableProps = {
  headers: string[];
  children: ReactNode;
  empty?: ReactNode;
};

export function Table({ headers, children, empty }: TableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-slate-800">
            {headers.map((h, i) => (
              <th
                key={i}
                className="whitespace-nowrap bg-slate-50/60 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/40 dark:text-slate-400"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{children}</tbody>
      </table>
      {empty && <div className="animate-fade-in px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">{empty}</div>}
    </div>
  );
}

export function TableRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <tr className={`transition-colors duration-100 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${className}`}>
      {children}
    </tr>
  );
}

export function TableCell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-slate-700 dark:text-slate-300 ${className}`}>{children}</td>;
}
