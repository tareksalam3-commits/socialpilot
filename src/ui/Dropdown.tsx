import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayPosition, overlayAnchorTransform } from '@/hooks/useOverlayPosition';

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
  /** Extra classes for the panel itself (e.g. a wider fixed width for a
   * richer panel). Merged with the default panel styling, not a replacement
   * for it. */
  panelClassName?: string;
  /** Whether clicking anywhere inside the panel closes it. Fine for simple
   * menus of one-shot actions (the default), but rich panels with their own
   * interactive controls (a "mark all read" button, per-row delete icons,
   * scrollable lists) need this off so those clicks don't also dismiss the
   * panel. */
  closeOnItemClick?: boolean;
};

export function Dropdown({
  trigger,
  children,
  align = 'right',
  direction = 'down',
  className = '',
  panelClassName = '',
  closeOnItemClick = true,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const position = useOverlayPosition(open, triggerRef, { align, direction });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
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
    <div ref={triggerRef} className={`relative ${className}`}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: position.top,
              left: position.left,
              transform: overlayAnchorTransform(align, direction),
            }}
            // Layering: this panel sits in the "Dropdown/Popover/Notification"
            // tier (z-40) — above ordinary page content/header/sidebar, but
            // below Modal/Dialog (z-50) per the app's overlay hierarchy.
            // Portaled to document.body, so no ancestor's overflow-hidden or
            // transform can clip/reposition it.
            className={`z-40 min-w-[12rem] animate-scale-in rounded-lg border border-slate-200 bg-white py-1 shadow-popover dark:border-slate-800 dark:bg-slate-900 ${
              direction === 'up'
                ? align === 'right'
                  ? 'origin-bottom-right'
                  : 'origin-bottom-left'
                : align === 'right'
                  ? 'origin-top-right'
                  : 'origin-top-left'
            } ${panelClassName}`}
            onClick={closeOnItemClick ? () => setOpen(false) : undefined}
          >
            {children}
          </div>,
          document.body,
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
