import { useCallback, useEffect, useState } from 'react';
import { urlBase64ToUint8Array } from '@/utils/vapid';
import { pushSubscriptionRepository } from '@/repositories/pushSubscriptionRepository';
import { haptic } from '@/utils/haptics';

type PushState = {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  loading: boolean;
  error: string | null;
};

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushState>({
    supported: isSupported(),
    permission: isSupported() ? Notification.permission : 'unsupported',
    subscribed: false,
    loading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    if (!isSupported()) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      setState((s) => ({
        ...s,
        permission: Notification.permission,
        subscribed: !!existing,
        loading: false,
      }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Failed to read subscription' }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The service worker can silently rotate the push endpoint in the
  // background (see `pushsubscriptionchange` in src/sw.ts) and posts the
  // replacement here so it gets persisted even though no explicit
  // subscribe() call happened on this page.
  useEffect(() => {
    if (!isSupported()) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'PUSH_SUBSCRIPTION_CHANGED' && event.data.subscription) {
        pushSubscriptionRepository.save(event.data.subscription).catch(() => {});
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  const subscribe = useCallback(async () => {
    if (!isSupported()) return;
    if (!VAPID_PUBLIC_KEY) {
      setState((s) => ({ ...s, error: 'VITE_VAPID_PUBLIC_KEY is not configured' }));
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState((s) => ({ ...s, permission, loading: false }));
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
      await pushSubscriptionRepository.save(subscription.toJSON());
      haptic('success');
      setState((s) => ({ ...s, permission, subscribed: true, loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Subscription failed' }));
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    if (!isSupported()) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await pushSubscriptionRepository.remove(endpoint);
      }
      setState((s) => ({ ...s, subscribed: false, loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : 'Unsubscribe failed' }));
    }
  }, []);

  return { ...state, subscribe, unsubscribe };
}
