import { useEffect, useRef, useState, type ReactNode } from 'react';

export type DropdownProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  // 'down' (default) opens below the trigger — fine for topbar/inline
  // triggers. 'up' opens above it, which is what a trigger anchored to the
  // bottom of the viewport (like a sidebar footer profile menu) needs —
  // otherwise the menu renders past the bottom edge of the screen and is
  // effectively invisible/unusable.
  direction?: 'down' | 'up';
  className?: string;
};

export function Dropdown({ trigger, children, align = 'right', direction = 'down', className = '' }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open && (
        <div
          className={`absolute z-50 min-w-[12rem] animate-scale-in rounded-lg border border-slate-200 bg-white py-1 shadow-popover dark:border-slate-800 dark:bg-slate-900 ${
            direction === 'up' ? 'bottom-full mb-2' : 'mt-2'
          } ${align === 'right' ? 'right-0' : 'left-0'} ${
            direction === 'up'
              ? align === 'right'
                ? 'origin-bottom-right'
                : 'origin-bottom-left'
              : align === 'right'
                ? 'origin-top-right'
                : 'origin-top-left'
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
      className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-slate-700 transition-colors duration-100 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${className}`}
    >
      {children}
    </button>
  );
}
