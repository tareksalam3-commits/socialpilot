import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

const supabaseConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

function ConfigurationRequiredScreen({ error }: { error?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 dark:bg-slate-950" dir="auto">
      <section className="w-full max-w-xl rounded-xl border border-amber-200 bg-white p-6 shadow-card dark:border-amber-900/50 dark:bg-slate-900">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">Configuration required</p>
        <h1 className="mt-2 text-xl font-bold text-slate-900 dark:text-white">يلزم إعداد التطبيق قبل تشغيله</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          أضف <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">VITE_SUPABASE_URL</code> و{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">VITE_SUPABASE_ANON_KEY</code> إلى ملف البيئة المحلي، ثم أعد تشغيل الخادم.
        </p>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
          Add <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">VITE_SUPABASE_URL</code> and{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-800">VITE_SUPABASE_ANON_KEY</code> to your local environment file, then restart the server.
        </p>
        {error && (
          <pre className="mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </pre>
        )}
      </section>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);

if (!supabaseConfigured) {
  root.render(
    <StrictMode>
      <ConfigurationRequiredScreen />
    </StrictMode>,
  );
} else {
  // Keep the Supabase-dependent application tree out of the initial module
  // graph until its required environment values are available. This prevents a
  // top-level client initialization error from leaving `#root` blank.
  void import('./App.tsx')
    .then(({ default: App }) => {
      sessionStorage.removeItem('sp_stale_chunk_reload');
      root.render(
        <StrictMode>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </StrictMode>,
      );
    })
    .catch((error: unknown) => {
      root.render(
        <StrictMode>
          <ConfigurationRequiredScreen error={error instanceof Error ? error.message : 'Unable to load the application.'} />
        </StrictMode>,
      );
    });
}
