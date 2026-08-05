import type { ReactNode } from 'react';

export type TabsProps = {
  tabs: { id: string; label: string; icon?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  return (
    <div className={`flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
            active === tab.id
              ? 'border-slate-900 text-slate-900 dark:border-white dark:text-white'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
