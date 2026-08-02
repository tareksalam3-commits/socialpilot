import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { automationRepository, type FailedQueueRow } from '@/repositories/automationRepository';
import { automationService } from '@/services/automationService';
import { supabase } from '@/services/supabase';
import type { Post, PublishingLog, SchedulerStatus } from '@/types/social';

export function useAutomation() {
  const { workspace, refresh: refreshWorkspace } = useWorkspace();
  const [queue, setQueue] = useState<Post[]>([]);
  const [scheduledJobs, setScheduledJobs] = useState<Post[]>([]);
  const [failedQueue, setFailedQueue] = useState<FailedQueueRow[]>([]);
  const [logs, setLogs] = useState<PublishingLog[]>([]);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setLoading(true);
      setError(null);
      const [q, sched, failed, execLogs, status] = await Promise.all([
        automationRepository.getPublishingQueue(workspace.id),
        automationRepository.getScheduledJobs(workspace.id),
        automationRepository.getFailedQueue(workspace.id),
        automationRepository.getExecutionLogs(workspace.id),
        automationRepository.getSchedulerStatus().catch(() => null),
      ]);
      setQueue(q);
      setScheduledJobs(sched);
      setFailedQueue(failed);
      setLogs(execLogs);
      setSchedulerStatus(status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load automation data');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  // Background Jobs run unattended (pg_cron), so this view must reflect
  // their effect — a post moving through scheduled → publishing →
  // published/failed, or a target retrying — without a manual refresh.
  // This also means the queue is correct after a page refresh or an app
  // restart: it's re-derived from the database, not from any client state.
  useEffect(() => {
    if (!workspace) return;
    const channel = supabase
      .channel(`automation-${workspace.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'posts', filter: `workspace_id=eq.${workspace.id}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_platform_targets' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'publishing_logs', filter: `workspace_id=eq.${workspace.id}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace, load]);

  const retryTarget = useCallback(
    async (targetId: string) => {
      if (!workspace) return;
      setActioningId(targetId);
      try {
        await automationService.retryTarget(workspace.id, targetId);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Retry failed');
      } finally {
        setActioningId(null);
      }
    },
    [workspace, load],
  );

  const retryAllFailed = useCallback(async () => {
    if (!workspace) return;
    setActioningId('all');
    try {
      await automationService.retryAllFailed(workspace.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setActioningId(null);
    }
  }, [workspace, load]);

  const runNow = useCallback(async () => {
    if (!workspace) return;
    setActioningId('run_now');
    try {
      await automationService.runNow(workspace.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setActioningId(null);
    }
  }, [workspace, load]);

  const setAutoPublishEnabled = useCallback(
    async (enabled: boolean) => {
      if (!workspace) return;
      try {
        await automationRepository.setAutoPublishEnabled(workspace.id, enabled);
        await refreshWorkspace();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update setting');
      }
    },
    [workspace, refreshWorkspace],
  );

  return {
    workspace,
    queue,
    scheduledJobs,
    failedQueue,
    logs,
    schedulerStatus,
    loading,
    error,
    actioningId,
    reload: load,
    retryTarget,
    retryAllFailed,
    runNow,
    setAutoPublishEnabled,
  };
}
