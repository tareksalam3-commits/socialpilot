import { useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock,
  ListChecks,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  XCircle,
} from 'lucide-react';
import { useAutomation } from '@/hooks/useAutomation';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Card, Button, EmptyState, ErrorState, Table, TableRow, TableCell } from '@/ui';
import { formatDateTime, timeAgo } from '@/utils/format';
import type { PublishingLog } from '@/types/social';

export function AutomationPage() {
  const { t } = useLanguage();
  const {
    workspace,
    queue,
    scheduledJobs,
    failedQueue,
    logs,
    schedulerStatus,
    loading,
    error,
    actioningId,
    reload,
    retryTarget,
    retryAllFailed,
    runNow,
    setAutoPublishEnabled,
  } = useAutomation();
  const { push } = useToast();
  const [togglingAutoPublish, setTogglingAutoPublish] = useState(false);

  const logEventLabel: Record<PublishingLog['event'], string> = {
    queued: t('publishing.logEvent.queued'),
    attempt: t('publishing.logEvent.attempt'),
    success: t('publishing.logEvent.success'),
    failure: t('publishing.logEvent.failure'),
    retry_scheduled: t('publishing.logEvent.retryScheduled'),
    gave_up: t('publishing.logEvent.gaveUp'),
  };

  const logEventVariant: Record<PublishingLog['event'], 'default' | 'success' | 'error' | 'warning' | 'info'> = {
    queued: 'default',
    attempt: 'info',
    success: 'success',
    failure: 'error',
    retry_scheduled: 'warning',
    gave_up: 'error',
  };

  const relativeCountdown = (dateStr: string): string => {
    const diffMs = new Date(dateStr).getTime() - Date.now();
    if (diffMs <= 0) return t('automation.countdown.dueNow');
    const minutes = Math.round(diffMs / 60000);
    if (minutes < 60) return t('automation.countdown.inMinutes', { count: minutes });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t('automation.countdown.inHours', { count: hours });
    const days = Math.round(hours / 24);
    return t('automation.countdown.inDays', { count: days });
  };

  const handleToggleAutoPublish = async () => {
    if (!workspace) return;
    setTogglingAutoPublish(true);
    try {
      await setAutoPublishEnabled(!workspace.auto_publish_enabled);
      push({ title: workspace.auto_publish_enabled ? t('automation.autoPublish.toast.paused') : t('automation.autoPublish.toast.enabled'), variant: 'success' });
    } finally {
      setTogglingAutoPublish(false);
    }
  };

  const handleRetryTarget = async (targetId: string) => {
    await retryTarget(targetId);
    push({ title: t('automation.toast.retryAttempted.title'), description: t('automation.toast.retryAttempted.description'), variant: 'info' });
  };

  const handleRetryAllFailed = async () => {
    await retryAllFailed();
    push({ title: t('automation.toast.retryingFailed.title'), description: t('automation.toast.retryingFailed.description'), variant: 'info' });
  };

  const handleRunNow = async () => {
    await runNow();
    push({ title: t('automation.toast.jobsTriggered.title'), description: t('automation.toast.jobsTriggered.description'), variant: 'info' });
  };

  if (!workspace) return null;

  const publishingCount = queue.filter((p) => p.status === 'publishing').length;
  const scheduledCount = scheduledJobs.length;
  const failedCount = failedQueue.length;
  const publishedToday = logs.filter((l) => l.event === 'success' && new Date(l.created_at).toDateString() === new Date().toDateString()).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('automation.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('automation.subtitle')}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            onClick={handleToggleAutoPublish}
            disabled={togglingAutoPublish}
            className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition disabled:opacity-50 ${
              workspace.auto_publish_enabled
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                : 'border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
            }`}
            title={t('automation.autoPublish.tooltip')}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${workspace.auto_publish_enabled ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {t('automation.autoPublish.label')} {workspace.auto_publish_enabled ? t('automation.autoPublish.on') : t('automation.autoPublish.off')}
          </button>
          <div className="flex gap-2">
            <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => reload()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {t('automation.refresh')}
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={handleRunNow} disabled={actioningId === 'run_now'}>
              <Play className="h-4 w-4" /> {t('automation.runJobsNow')}
            </Button>
          </div>
        </div>
      </div>

      {error && <ErrorState description={error} onRetry={() => reload()} />}

      {/* Job Status summary */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={<Send className="h-4 w-4" />} label={t('automation.stat.publishing')} value={publishingCount} />
        <StatCard icon={<CalendarClock className="h-4 w-4" />} label={t('automation.stat.scheduled')} value={scheduledCount} />
        <StatCard icon={<XCircle className="h-4 w-4" />} label={t('automation.stat.failed')} value={failedCount} tone={failedCount > 0 ? 'error' : 'default'} />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label={t('automation.stat.publishedToday')} value={publishedToday} tone="success" />
      </div>

      {/* Background Jobs */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Bot className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('automation.backgroundJobs.title')}</h2>
        </div>
        {schedulerStatus ? (
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('automation.backgroundJobs.status')}</p>
              <div className="mt-1">
                <Badge variant={schedulerStatus.active ? 'success' : 'default'}>{schedulerStatus.active ? t('automation.backgroundJobs.active') : t('automation.backgroundJobs.inactive')}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('automation.backgroundJobs.runsEvery', { schedule: schedulerStatus.schedule })}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('automation.backgroundJobs.lastRun')}</p>
              <p className="mt-1 font-medium text-slate-900 dark:text-white">{schedulerStatus.last_run_at ? timeAgo(schedulerStatus.last_run_at) : t('automation.backgroundJobs.never')}</p>
              {schedulerStatus.last_run_status && (
                <div className="mt-1">
                  <Badge variant={schedulerStatus.last_run_status === 'succeeded' ? 'success' : 'error'}>{schedulerStatus.last_run_status}</Badge>
                </div>
              )}
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('automation.backgroundJobs.persistence')}</p>
              <p className="mt-1 text-slate-600 dark:text-slate-400">{t('automation.backgroundJobs.persistenceDescription')}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('automation.backgroundJobs.notAvailable')}</p>
        )}
      </Card>

      {/* Publishing Queue */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('automation.queue.title')}</h2>
        </div>
        {queue.length === 0 ? (
          <EmptyState icon={<Send className="h-8 w-8" />} title={t('automation.queue.empty.title')} description={t('automation.queue.empty.description')} />
        ) : (
          <Table headers={[t('automation.queue.header.status'), t('automation.queue.header.content'), t('automation.queue.header.platforms'), t('automation.queue.header.scheduledFor')]}>
            {queue.map((p) => (
              <TableRow key={p.id}>
                <TableCell><Badge variant={p.status === 'publishing' ? 'info' : 'default'}>{t(`post.status.${p.status}`)}</Badge></TableCell>
                <TableCell className="max-w-xs truncate">{p.title || p.content || t('posts.noContent')}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.platforms.join(', ') || '—'}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.scheduled_for ? formatDateTime(p.scheduled_for) : '—'}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      {/* Scheduled Jobs */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('automation.scheduledJobs.title')}</h2>
        </div>
        {scheduledJobs.length === 0 ? (
          <EmptyState icon={<CalendarClock className="h-8 w-8" />} title={t('automation.scheduledJobs.empty.title')} description={t('automation.scheduledJobs.empty.description')} />
        ) : (
          <Table headers={[t('automation.scheduledJobs.header.content'), t('automation.scheduledJobs.header.platforms'), t('automation.scheduledJobs.header.runsAt'), t('automation.scheduledJobs.header.timeUntil')]}>
            {scheduledJobs.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="max-w-xs truncate">{p.title || p.content || t('posts.noContent')}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.platforms.join(', ') || '—'}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.scheduled_for ? formatDateTime(p.scheduled_for) : '—'}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{p.scheduled_for ? relativeCountdown(p.scheduled_for) : '—'}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      {/* Failed Queue */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('automation.failedQueue.title')}</h2>
          </div>
          {failedQueue.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleRetryAllFailed} disabled={actioningId === 'all'}>
              <RotateCcw className="h-3.5 w-3.5" /> {t('automation.failedQueue.retryAll')}
            </Button>
          )}
        </div>
        {failedQueue.length === 0 ? (
          <EmptyState icon={<CheckCircle2 className="h-8 w-8" />} title={t('automation.failedQueue.empty.title')} description={t('automation.failedQueue.empty.description')} />
        ) : (
          <Table headers={[t('automation.failedQueue.header.content'), t('automation.failedQueue.header.platform'), t('automation.failedQueue.header.error'), t('automation.failedQueue.header.retries'), t('automation.failedQueue.header.nextRetry'), t('automation.failedQueue.header.actions')]}>
            {failedQueue.map((tgt) => (
              <TableRow key={tgt.id}>
                <TableCell className="max-w-xs truncate">{tgt.post_title || tgt.post_content || t('posts.noContent')}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{tgt.platform}</TableCell>
                <TableCell className="max-w-xs truncate text-xs text-rose-600 dark:text-rose-400" title={tgt.error_message ?? undefined}>{tgt.error_message ?? '—'}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{tgt.retry_count}/{tgt.max_retries}</TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">{tgt.next_retry_at ? formatDateTime(tgt.next_retry_at) : tgt.retry_count >= tgt.max_retries ? t('automation.failedQueue.gaveUp') : '—'}</TableCell>
                <TableCell>
                  <button
                    onClick={() => handleRetryTarget(tgt.id)}
                    disabled={actioningId === tgt.id}
                    className="flex min-h-[36px] items-center gap-1 rounded px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:opacity-50 dark:hover:bg-slate-800"
                    title={t('automation.failedQueue.retryNow')}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> {t('automation.failedQueue.retryButton')}
                  </button>
                </TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </Card>

      {/* Execution Logs */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t('automation.executionLogs.title')}</h2>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('automation.executionLogs.empty')}</p>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 text-xs last:border-0 dark:border-slate-800">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant={logEventVariant[l.event]}>{logEventLabel[l.event]}</Badge>
                    {l.platform && <span className="text-slate-500 dark:text-slate-400">{l.platform}</span>}
                  </div>
                  {l.message && <p className="mt-1 truncate text-slate-600 dark:text-slate-400" title={l.message}>{l.message}</p>}
                </div>
                <span className="shrink-0 text-slate-400 dark:text-slate-500">{formatDateTime(l.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, tone = 'default' }: { icon: ReactNode; label: string; value: number; tone?: 'default' | 'success' | 'error' }) {
  const toneClasses = {
    default: 'text-slate-900 dark:text-white',
    success: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-rose-600 dark:text-rose-400',
  }[tone];
  return (
    <Card>
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`mt-2 text-2xl font-bold ${toneClasses}`}>{value}</p>
    </Card>
  );
}
