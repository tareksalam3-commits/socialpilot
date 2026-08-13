import { supabase } from '@/services/supabase';

export type PlatformSummary = {
  totalUsers: number;
  totalWorkspaces: number;
  activeSubscriptions: number;
  totalRevenue: number;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
};

export const adminAnalyticsRepository = {
  async summary(): Promise<PlatformSummary> {
    const [{ count: totalWorkspaces }, { count: activeSubscriptions }, { data: payments }, { data: usage }, { count: totalUsers }] =
      await Promise.all([
        supabase.from('workspaces').select('id', { count: 'exact', head: true }),
        supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('payments').select('amount').eq('status', 'paid'),
        supabase.from('ai_usage').select('credits_used, credits_limit'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ]);

    const totalRevenue = (payments ?? []).reduce((sum, p) => sum + Number((p as { amount: number }).amount ?? 0), 0);
    const aiCreditsUsed = (usage ?? []).reduce((sum, u) => sum + Number((u as { credits_used: number }).credits_used ?? 0), 0);
    const aiCreditsLimit = (usage ?? []).reduce((sum, u) => sum + Number((u as { credits_limit: number }).credits_limit ?? 0), 0);

    return {
      totalUsers: totalUsers ?? 0,
      totalWorkspaces: totalWorkspaces ?? 0,
      activeSubscriptions: activeSubscriptions ?? 0,
      totalRevenue,
      aiCreditsUsed,
      aiCreditsLimit,
    };
  },
};
