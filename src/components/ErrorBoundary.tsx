import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

type Props = { children: ReactNode };
type State = { error: Error | null };

const RELOAD_FLAG = 'sp_stale_chunk_reload';

function isStaleChunkError(error: Error): boolean {
  const msg = error.message || '';
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /importing a module script failed/i.test(msg) ||
    /Loading chunk .* failed/i.test(msg)
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('App crashed:', error, info);

    // A stale JS chunk (old filename hash no longer on the server after a new
    // deploy) isn't a real app bug — the fix is just loading the fresh app
    // shell. Reload once automatically instead of showing the crash screen;
    // the sessionStorage flag stops a reload loop if it somehow keeps failing.
    if (isStaleChunkError(error) && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, '1');
      window.location.reload();
    }
  }

  render() {
    if (this.state.error) {
      if (isStaleChunkError(this.state.error) && typeof window !== 'undefined' && sessionStorage.getItem(RELOAD_FLAG)) {
        // Reload already triggered in componentDidCatch — avoid flashing the crash screen.
        return null;
      }

      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="w-full max-w-xl animate-slide-up rounded-xl border border-rose-200 bg-white p-6 shadow-card dark:border-rose-900/50 dark:bg-slate-900">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-100 text-rose-500 dark:bg-rose-950 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-rose-600 dark:text-rose-400">حدث خطأ غير متوقع</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">
              {this.state.error.message}
            </p>
            <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.assign('/login')}
              className="press-effect mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-subtle transition-colors hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              العودة لتسجيل الدخول
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
