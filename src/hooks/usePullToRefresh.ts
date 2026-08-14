import { useEffect, useRef, useState, type RefObject } from 'react';
import { haptic } from '@/utils/haptics';

const TRIGGER_DISTANCE = 70; // px of (resisted) pull needed to arm a refresh
const MAX_PULL = 120; // visual cap on how far the indicator travels
const RESISTANCE = 2.2; // higher = harder to pull, like iOS/Android rubber-banding

type PullState = 'idle' | 'pulling' | 'armed' | 'refreshing';

/**
 * Wires native-style pull-to-refresh onto a scrollable container. Only
 * activates when the container is already scrolled to the top, so it never
 * fights normal vertical scrolling further down the page.
 *
 * Usage:
 *   const { pullDistance, state, containerRef } = usePullToRefresh(onRefresh);
 *   <main ref={containerRef}>...</main>
 */
export function usePullToRefresh<T extends HTMLElement>(
  onRefresh: () => Promise<void> | void,
  { disabled = false }: { disabled?: boolean } = {},
): { containerRef: RefObject<T>; pullDistance: number; state: PullState } {
  const containerRef = useRef<T>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [state, setState] = useState<PullState>('idle');
  const startY = useRef(0);
  const tracking = useRef(false);
  const armedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || disabled) return;

    // Coarse pointer = touch device; skip entirely on mouse/trackpad so
    // desktop scrolling behaves exactly as before.
    if (!window.matchMedia('(pointer: coarse)').matches) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop > 0 || state === 'refreshing') return;
      tracking.current = true;
      armedRef.current = false;
      startY.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!tracking.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPullDistance(0);
        setState('idle');
        return;
      }
      // Stop the page itself from rubber-banding while our own indicator does.
      if (el.scrollTop <= 0) e.preventDefault();
      const resisted = Math.min(MAX_PULL, delta / RESISTANCE);
      setPullDistance(resisted);
      const nowArmed = resisted >= TRIGGER_DISTANCE;
      if (nowArmed && !armedRef.current) haptic('medium');
      armedRef.current = nowArmed;
      setState(nowArmed ? 'armed' : 'pulling');
    };

    const onTouchEnd = async () => {
      if (!tracking.current) return;
      tracking.current = false;
      if (armedRef.current) {
        setState('refreshing');
        setPullDistance(TRIGGER_DISTANCE);
        haptic('success');
        try {
          await onRefresh();
        } finally {
          setState('idle');
          setPullDistance(0);
          armedRef.current = false;
        }
      } else {
        setState('idle');
        setPullDistance(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, onRefresh, state]);

  return { containerRef, pullDistance, state };
}
