import { supabase } from '@/services/supabase';

export const pushSubscriptionRepository = {
  /** Upserts on `endpoint` so re-subscribing the same device (e.g. after the
   *  browser silently rotates its push endpoint) updates the existing row
   *  instead of accumulating duplicates. */
  async save(subscription: PushSubscriptionJSON): Promise<void> {
    if (!subscription.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      throw new Error('Invalid push subscription payload');
    }
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: navigator.userAgent,
      },
      { onConflict: 'endpoint' },
    );
    if (error) throw error;
  },

  async remove(endpoint: string): Promise<void> {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) throw error;
  },

  async isSubscribed(endpoint: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('endpoint', endpoint)
      .maybeSingle();
    if (error) throw error;
    return !!data;
  },
};
