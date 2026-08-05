import { useEffect, useRef, useState, type ReactNode } from 'react';

export type DropdownProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
};

export function Dropdown({ trigger, children, align = 'right', className = '' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className={`absolute z-50 mt-2 min-w-[12rem] rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${className}`}
    >
      {children}
    </button>
  );
}
