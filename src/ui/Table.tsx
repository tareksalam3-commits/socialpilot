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
                className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{children}</tbody>
      </table>
      {empty && <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">{empty}</div>}
    </div>
  );
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">{children}</tr>;
}

export function TableCell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-4 py-3 text-slate-700 dark:text-slate-300 ${className}`}>{children}</td>;
}
