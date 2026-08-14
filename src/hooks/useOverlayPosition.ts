import { useCallback, useEffect, useState, type RefObject } from 'react';

export type OverlayAlign = 'left' | 'right';
export type OverlayDirection = 'down' | 'up';

export type OverlayPosition = { top: number; left: number } | null;

/**
 * Computes a viewport-relative anchor point for a `position: fixed` overlay
 * panel (Dropdown menu, NotificationCenter, any future Popover) that is
 * rendered through a Portal into `document.body`.
 *
 * Why this exists: once a panel is portaled to `document.body`, it's no
 * longer a DOM descendant of its trigger button, so plain CSS `absolute`
 * positioning relative to the trigger no longer works — the panel needs its
 * position computed in JS from the trigger's `getBoundingClientRect()`
 * instead. This is the trade-off for the panel becoming immune to any
 * ancestor's `overflow: hidden`, `transform`, or stacking context, which is
 * exactly the class of bug (overlays clipped or trapped behind content)
 * this hook exists to eliminate.
 *
 * The returned `top`/`left` is the anchor corner only — callers combine it
 * with a CSS `transform: translate(-100%, 0)` / `translate(0, -100%)` (see
 * Dropdown.tsx) to flip the panel to the correct side without needing to
 * know its rendered width/height ahead of time.
 *
 * Position is recomputed on open, and while open on any scroll or resize —
 * including scrolling inside an internal container like `<main>` (scroll
 * events don't bubble, so the listener is registered with `capture: true`
 * on `document`, which does see them during the capture phase).
 */
export function useOverlayPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  { align = 'right', direction = 'down', gap = 8 }: { align?: OverlayAlign; direction?: OverlayDirection; gap?: number } = {},
): OverlayPosition {
  const [position, setPosition] = useState<OverlayPosition>(null);

  const recompute = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition({
      top: direction === 'up' ? rect.top - gap : rect.bottom + gap,
      left: align === 'right' ? rect.right : rect.left,
    });
  }, [triggerRef, align, direction, gap]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    recompute();
    window.addEventListener('resize', recompute);
    document.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      document.removeEventListener('scroll', recompute, true);
    };
  }, [open, recompute]);

  return position;
}

/** Matching transform so the panel flips to the correct side of its anchor
 * point without needing to measure its own rendered size first. */
export function overlayAnchorTransform(align: OverlayAlign, direction: OverlayDirection): string | undefined {
  const x = align === 'right' ? '-100%' : '0';
  const y = direction === 'up' ? '-100%' : '0';
  return x === '0' && y === '0' ? undefined : `translate(${x}, ${y})`;
}
