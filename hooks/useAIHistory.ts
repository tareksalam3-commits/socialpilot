import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { aiHistoryRepository, aiAnalyticsRepository } from '@/repositories/aiHistoryRepository';
import type { AiHistoryEntry, AiAnalytics } from '@/types/ai';

export function useAIHistory() {
  const { user } = useAuth();
  const [history, setHistory] = useState<AiHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const data = await aiHistoryRepository.list(user.id);
      setHistory(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const search = useCallback(
    async (query: string) => {
      if (!user || !query.trim()) {
        load();
        return;
      }
      try {
        const results = await aiHistoryRepository.search(user.id, query);
        setHistory(results);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
      }
    },
    [user, load],
  );

  const toggleFavorite = useCallback(async (id: string, favorite: boolean) => {
    try {
      await aiHistoryRepository.toggleFavorite(id, favorite);
      setHistory((prev) => prev.map((h) => (h.id === id ? { ...h, favorite } : h)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle favorite');
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      await aiHistoryRepository.remove(id);
      setHistory((prev) => prev.filter((h) => h.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete entry');
    }
  }, []);

  return { history, loading, error, search, toggleFavorite, remove, reload: load };
}

export function useAIAnalytics(days = 30) {
  const { user } = useAuth();
  const [analytics, setAnalytics] = useState<AiAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const events = await aiAnalyticsRepository.getEvents(user.id, days);
        setAnalytics(aiAnalyticsRepository.computeAnalytics(events));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    })();
  }, [user, days]);

  return { analytics, loading, error };
}
