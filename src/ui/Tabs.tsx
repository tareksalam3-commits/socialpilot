import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type TabsProps = {
  tabs: { id: string; label: string; icon?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = tabRefs.current[active];
    const container = containerRef.current;
    if (el && container) {
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    }
  }, [active, tabs]);

  // Re-measure on resize so the indicator stays aligned across breakpoints.
  useEffect(() => {
    const onResize = () => {
      const el = tabRefs.current[active];
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [active]);

  return (
    <div
      ref={containerRef}
      className={`relative flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800 ${className}`}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          ref={(el) => {
            tabRefs.current[tab.id] = el;
          }}
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-2 whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors duration-150 ${
            active === tab.id
              ? 'text-slate-900 dark:text-white'
              : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
      {indicator && (
        <span
          className="pointer-events-none absolute bottom-0 h-0.5 rounded-full bg-slate-900 transition-all duration-250 ease-smooth dark:bg-white"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
    </div>
  );
}
