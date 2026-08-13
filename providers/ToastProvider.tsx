import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';

export type Toast = {
  id: string;
  title: string;
  description?: string;
  variant: 'success' | 'error' | 'info';
};

type ToastContextValue = {
  toasts: Toast[];
  push: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const TOAST_DURATION_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...t, id }]);
    // Auto-dismiss timing lives in ToastItem so it can play its exit
    // animation instead of disappearing instantly.
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, push, dismiss }}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

const variantStyles = {
  success: {
    wrap: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
    icon: 'text-emerald-500 dark:text-emerald-400',
    bar: 'bg-emerald-500',
    Icon: CheckCircle2,
  },
  error: {
    wrap: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100',
    icon: 'text-rose-500 dark:text-rose-400',
    bar: 'bg-rose-500',
    Icon: AlertCircle,
  },
  info: {
    wrap: 'border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100',
    icon: 'text-slate-400 dark:text-slate-500',
    bar: 'bg-slate-400',
    Icon: Info,
  },
} as const;

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { t } = useLanguage();
  const [leaving, setLeaving] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const style = variantStyles[toast.variant];
  const Icon = style.Icon;

  const close = useCallback(() => {
    setLeaving(true);
    timerRef.current = setTimeout(onDismiss, 180);
  }, [onDismiss]);

  useEffect(() => {
    const autoTimer = setTimeout(close, TOAST_DURATION_MS);
    return () => {
      clearTimeout(autoTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      className={`pointer-events-auto relative overflow-hidden rounded-lg border shadow-popover backdrop-blur ${style.wrap} ${
        leaving ? 'animate-fade-out' : 'animate-slide-in-end'
      }`}
      style={{ ['--slide-from' as string]: '16px' }}
    >
      <div className="flex items-start gap-3 p-4">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{toast.title}</p>
          {toast.description && <p className="mt-0.5 text-sm opacity-80">{toast.description}</p>}
        </div>
        <button
          onClick={close}
          className="shrink-0 rounded p-0.5 opacity-60 transition hover:opacity-100"
          aria-label={t('common.dismiss')}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="h-0.5 w-full bg-black/5 dark:bg-white/10">
        <div
          className={`h-full origin-left animate-progress-shrink ${style.bar}`}
          style={{ animationDuration: '5000ms' }}
        />
      </div>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
