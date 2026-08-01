import { Component, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="max-w-xl rounded-xl border border-rose-200 bg-white p-6 shadow-sm dark:border-rose-900/50 dark:bg-slate-900">
            <h2 className="text-lg font-bold text-rose-600 dark:text-rose-400">حدث خطأ غير متوقع</h2>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">
              {this.state.error.message}
            </p>
            <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-100 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => window.location.assign('/login')}
              className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900"
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
