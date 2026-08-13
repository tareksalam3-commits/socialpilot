import { Loader2, ArrowDown } from 'lucide-react';

const TRIGGER_DISTANCE = 70;

export function PullToRefreshIndicator({
  pullDistance,
  state,
}: {
  pullDistance: number;
  state: 'idle' | 'pulling' | 'armed' | 'refreshing';
}) {
  if (state === 'idle' && pullDistance === 0) return null;

  const progress = Math.min(1, pullDistance / TRIGGER_DISTANCE);
  const rotation = progress * 180;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center overflow-hidden lg:hidden"
      style={{
        height: pullDistance,
        transition: state === 'refreshing' || pullDistance === 0 ? 'height 200ms ease-out' : 'none',
      }}
      aria-live="polite"
      aria-hidden={state === 'idle'}
    >
      <div className="flex h-9 w-9 translate-y-2 items-center justify-center rounded-full bg-white shadow-card ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
        {state === 'refreshing' ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-500 dark:text-slate-300" />
        ) : (
          <ArrowDown
            className={`h-4 w-4 transition-colors ${
              state === 'armed' ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'
            }`}
            style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 120ms ease-out' }}
          />
        )}
      </div>
    </div>
  );
}
