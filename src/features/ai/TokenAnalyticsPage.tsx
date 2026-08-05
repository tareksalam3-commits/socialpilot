import { useState } from 'react';
import { Activity, BarChart3, Clock, TrendingUp, Zap } from 'lucide-react';
import { useAIAnalytics } from '@/hooks/useAIHistory';
import { useLanguage } from '@/providers/LanguageProvider';
import { Card, CardSkeleton, Badge, ErrorState, EmptyState } from '@/ui';

export function TokenAnalyticsPage() {
  const { t } = useLanguage();
  const [days, setDays] = useState(30);
  const { analytics, loading, error } = useAIAnalytics(days);

  if (error) return <ErrorState description={error} />;
  if (loading) return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)}</div>;
  if (!analytics || analytics.totalRequests === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.tokenAnalytics.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('ai.tokenAnalytics.subtitle')}</p>
        </div>
        <Card><EmptyState icon={<BarChart3 className="h-10 w-10" />} title={t('ai.tokenAnalytics.empty.title')} description={t('ai.tokenAnalytics.empty.description')} /></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.tokenAnalytics.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('ai.tokenAnalytics.subtitle')}</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value, 10))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value={7}>{t('analytics.range.7d')}</option>
          <option value={30}>{t('analytics.range.30d')}</option>
          <option value={90}>{t('analytics.range.90d')}</option>
        </select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<Activity className="h-5 w-5" />} label={t('ai.tokenAnalytics.stat.totalRequests')} value={analytics.totalRequests} tone="sky" />
        <StatCard icon={<Zap className="h-5 w-5" />} label={t('ai.tokenAnalytics.stat.totalTokens')} value={analytics.totalTokensIn + analytics.totalTokensOut} hint={t('ai.tokenAnalytics.stat.inOut', { in: analytics.totalTokensIn, out: analytics.totalTokensOut })} tone="amber" />
        <StatCard icon={<Clock className="h-5 w-5" />} label={t('ai.tokenAnalytics.stat.avgResponseTime')} value={`${analytics.avgResponseTime}ms`} tone="emerald" />
        <StatCard icon={<TrendingUp className="h-5 w-5" />} label={t('ai.tokenAnalytics.stat.successRate')} value={`${analytics.successRate}%`} hint={t('ai.tokenAnalytics.stat.failureRate', { pct: analytics.failureRate })} tone="slate" />
      </div>

      {/* Model breakdown */}
      <Card title={t('ai.tokenAnalytics.models.title')} description={t('ai.tokenAnalytics.models.description')}>
        {analytics.byModel.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('ai.tokenAnalytics.models.noData')}</p>
        ) : (
          <div className="space-y-3">
            {analytics.byModel.map((m) => {
              const maxReq = analytics.byModel[0].requests || 1;
              const pct = Math.round((m.requests / maxReq) * 100);
              return (
                <div key={m.model}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-slate-700 dark:text-slate-300">{m.model}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{t('ai.tokenAnalytics.models.reqTokens', { req: m.requests, tok: m.tokens })}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Prompt type breakdown */}
      <Card title={t('ai.tokenAnalytics.promptTypes.title')} description={t('ai.tokenAnalytics.promptTypes.description')}>
        {analytics.byPromptType.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">{t('ai.tokenAnalytics.models.noData')}</p>
        ) : (
          <div className="space-y-2">
            {analytics.byPromptType.map((pt) => {
              const maxReq = analytics.byPromptType[0].requests || 1;
              const pct = Math.round((pt.requests / maxReq) * 100);
              return (
                <div key={pt.type}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-700 dark:text-slate-300">{pt.type}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{t('ai.tokenAnalytics.models.reqTokens', { req: pt.requests, tok: pt.tokens })}</span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Provider status */}
      <Card title={t('ai.settings.provider.title')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            { name: 'OpenRouter', status: 'active' },
            { name: 'Groq', status: 'prepared' },
            { name: 'Google AI', status: 'prepared' },
            { name: 'HuggingFace', status: 'prepared' },
            { name: 'Cloudflare AI', status: 'prepared' },
            { name: 'Ollama', status: 'prepared' },
          ].map((p) => (
            <div key={p.name} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-800">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{p.name}</span>
              <Badge variant={p.status === 'active' ? 'success' : 'default'}>{p.status === 'active' ? t('common.active') : t('common.ready')}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const toneMap = {
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

function StatCard({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string | number; hint?: string; tone: keyof typeof toneMap }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneMap[tone]}`}>{icon}</div>
      <p className="mt-3 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  );
}
