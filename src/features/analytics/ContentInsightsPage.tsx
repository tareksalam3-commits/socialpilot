import { useState } from 'react';
import { Brain, Lightbulb, TrendingUp, TrendingDown, AlertTriangle, Check, X, BarChart3 } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';
import { useContentInsights } from '@/hooks/useContentInsights';
import { Badge, Card, CardSkeleton, EmptyState, ErrorState, Tabs, Button } from '@/ui';
import type { ContentRecommendation } from '@/repositories/contentRecommendationsRepository';
import type { ContentLearning } from '@/repositories/contentLearningsRepository';

type InsightsTab = 'performance' | 'learnings' | 'recommendations';

function confidenceVariant(confidence: number | null): 'success' | 'warning' | 'default' {
  if (confidence === null) return 'default';
  if (confidence >= 0.75) return 'success';
  if (confidence >= 0.6) return 'warning';
  return 'default';
}

function confidenceLabel(confidence: number | null, t: (k: string) => string): string {
  if (confidence === null) return '';
  if (confidence >= 0.75) return t('insights.confidence.high');
  if (confidence >= 0.6) return t('insights.confidence.medium');
  return t('insights.confidence.low');
}

export function ContentInsightsPage() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<InsightsTab>('performance');
  const insights = useContentInsights();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('insights.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('insights.subtitle')}</p>
      </div>

      <Tabs
        tabs={[
          { id: 'performance', label: t('insights.tab.performance') },
          { id: 'learnings', label: t('insights.tab.learnings') },
          { id: 'recommendations', label: t('insights.tab.recommendations') },
        ]}
        active={tab}
        onChange={(id) => setTab(id as InsightsTab)}
      />

      {insights.error ? (
        <ErrorState title={insights.error} />
      ) : insights.loading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : tab === 'performance' ? (
        <PerformanceTab insights={insights} t={t} />
      ) : tab === 'learnings' ? (
        <LearningsTab insights={insights} t={t} />
      ) : (
        <RecommendationsTab insights={insights} t={t} />
      )}
    </div>
  );
}

// Section 32 — never a raw numbers dashboard. Baseline rows already carry
// the "what's normal" figure; this tab renders it as plain-language
// what-worked/what's-flat sentences, not a metrics table.
function PerformanceTab({ insights, t }: { insights: ReturnType<typeof useContentInsights>; t: (k: string, params?: Record<string, string | number>) => string }) {
  const overallBaselines = insights.baselines.filter((b) => !b.objective);
  const activeFatigue = insights.fatigueSignals.filter((f) => f.status === 'warning');

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-sky-500" />
          <h2 className="font-semibold text-slate-900 dark:text-white">{t('insights.baseline.title')}</h2>
        </div>
        {overallBaselines.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('insights.baseline.insufficientData')}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {overallBaselines.map((b) => (
              <div key={`${b.platform}`} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize text-slate-900 dark:text-white">{b.platform}</span>
                  <Badge variant={b.min_sample_size_met ? 'success' : 'default'}>
                    {b.min_sample_size_met ? `${b.sample_size} ${t('insights.samples')}` : t('insights.baseline.insufficientData')}
                  </Badge>
                </div>
                {b.min_sample_size_met && b.avg_engagement_rate !== null && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    {t('insights.baseline.samples')}: {b.sample_size} · avg engagement rate {(b.avg_engagement_rate * 100).toFixed(1)}%
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <h2 className="font-semibold text-slate-900 dark:text-white">{t('insights.fatigue.title')}</h2>
        </div>
        {activeFatigue.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('insights.fatigue.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {activeFatigue.map((f) => (
              <li key={f.id} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <span className="text-slate-700 dark:text-slate-200">
                  {f.dimension} "{f.value}" — {f.platform} ({Math.round((f.repeat_ratio ?? 0) * 100)}% {t('insights.samples')}, {f.performance_trend})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function LearningCard({ learning, t }: { learning: ContentLearning; t: (k: string) => string }) {
  const lift = (learning.evidence as { lift?: number })?.lift;
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-slate-800 dark:text-slate-100">{learning.learning}</p>
        {lift !== undefined && (
          <span className={`flex shrink-0 items-center gap-1 text-xs font-medium ${lift >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
            {lift >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
            {Math.round(Math.abs(lift) * 100)}%
          </span>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Badge variant={confidenceVariant(learning.confidence)}>
          {t('insights.confidence')}: {confidenceLabel(learning.confidence, t)}
        </Badge>
        <span>{t('insights.evidence')}: {learning.sample_size} {t('insights.samples')}</span>
        {learning.status !== 'ACTIVE' && <Badge variant="default">{learning.status}</Badge>}
      </div>
    </div>
  );
}

function LearningsTab({ insights, t }: { insights: ReturnType<typeof useContentInsights>; t: (k: string) => string }) {
  const active = insights.learnings.filter((l) => l.status === 'ACTIVE');
  if (active.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Brain className="h-10 w-10" />} title={t('insights.empty.learnings.title')} description={t('insights.empty.learnings.description')} />
      </Card>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {active.map((l) => (
        <LearningCard key={l.id} learning={l} t={t} />
      ))}
    </div>
  );
}

function RecommendationCard({
  recommendation,
  onApply,
  onDismiss,
  t,
}: {
  recommendation: ContentRecommendation;
  onApply: () => void;
  onDismiss: () => void;
  t: (k: string) => string;
}) {
  const isDecided = recommendation.status === 'APPLIED' || recommendation.status === 'DISMISSED';
  return (
    <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <div className="flex items-center gap-2">
        <Badge variant="info">{recommendation.type}</Badge>
        {isDecided && <Badge variant={recommendation.status === 'APPLIED' ? 'success' : 'default'}>{recommendation.status === 'APPLIED' ? t('insights.applied') : t('insights.dismissed')}</Badge>}
      </div>
      <p className="mt-2 font-medium text-slate-900 dark:text-white">{recommendation.recommendation}</p>
      {recommendation.reason && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{recommendation.reason}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Badge variant={confidenceVariant(recommendation.confidence)}>
          {t('insights.confidence')}: {confidenceLabel(recommendation.confidence, t)}
        </Badge>
        {recommendation.expected_impact && <span>{t('insights.expectedImpact')}: {recommendation.expected_impact}</span>}
      </div>
      {!isDecided && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="primary" onClick={onApply}>
            <Check className="h-4 w-4" /> {t('insights.apply')}
          </Button>
          <Button size="sm" variant="secondary" onClick={onDismiss}>
            <X className="h-4 w-4" /> {t('insights.dismiss')}
          </Button>
        </div>
      )}
    </div>
  );
}

function RecommendationsTab({ insights, t }: { insights: ReturnType<typeof useContentInsights>; t: (k: string) => string }) {
  const visible = insights.recommendations.filter((r) => r.status !== 'EXPIRED');
  if (visible.length === 0) {
    return (
      <Card>
        <EmptyState icon={<Lightbulb className="h-10 w-10" />} title={t('insights.empty.recommendations.title')} description={t('insights.empty.recommendations.description')} />
      </Card>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {visible.map((r) => (
        <RecommendationCard
          key={r.id}
          recommendation={r}
          onApply={() => insights.setRecommendationStatus(r.id, 'APPLIED')}
          onDismiss={() => insights.setRecommendationStatus(r.id, 'DISMISSED')}
          t={t}
        />
      ))}
    </div>
  );
}
