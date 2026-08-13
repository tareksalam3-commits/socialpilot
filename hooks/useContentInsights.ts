import { useCallback, useEffect, useState } from 'react';
import { useWorkspace } from '@/hooks/useWorkspace';
import { contentPerformanceBaselineRepository, type ContentPerformanceBaseline } from '@/repositories/contentPerformanceBaselineRepository';
import { contentLearningsRepository, type ContentLearning } from '@/repositories/contentLearningsRepository';
import { contentRecommendationsRepository, type ContentRecommendation, type RecommendationStatus } from '@/repositories/contentRecommendationsRepository';
import { contentFatigueRepository, type ContentFatigueSignal } from '@/repositories/contentFatigueRepository';

type InsightsState = {
  loading: boolean;
  error: string | null;
  baselines: ContentPerformanceBaseline[];
  learnings: ContentLearning[];
  recommendations: ContentRecommendation[];
  fatigueSignals: ContentFatigueSignal[];
  refresh: () => Promise<void>;
  setRecommendationStatus: (id: string, status: RecommendationStatus) => Promise<void>;
};

export function useContentInsights(): InsightsState {
  const { workspace } = useWorkspace();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baselines, setBaselines] = useState<ContentPerformanceBaseline[]>([]);
  const [learnings, setLearnings] = useState<ContentLearning[]>([]);
  const [recommendations, setRecommendations] = useState<ContentRecommendation[]>([]);
  const [fatigueSignals, setFatigueSignals] = useState<ContentFatigueSignal[]>([]);

  const refresh = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setError(null);
    try {
      const [b, l, r, f] = await Promise.all([
        contentPerformanceBaselineRepository.listByWorkspace(workspace.id),
        contentLearningsRepository.listAll(workspace.id),
        contentRecommendationsRepository.listByWorkspace(workspace.id),
        contentFatigueRepository.listByWorkspace(workspace.id),
      ]);
      setBaselines(b);
      setLearnings(l);
      setRecommendations(r);
      setFatigueSignals(f);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setRecommendationStatus = useCallback(async (id: string, status: RecommendationStatus) => {
    await contentRecommendationsRepository.updateStatus(id, status);
    setRecommendations((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
  }, []);

  return { loading, error, baselines, learnings, recommendations, fatigueSignals, refresh, setRecommendationStatus };
}
