import { Bell, BellRing, Loader2 } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { Button, Card } from '@/ui';

export function PushNotificationToggle() {
  const { t } = useLanguage();
  const { supported, permission, subscribed, loading, subscribe, unsubscribe } = usePushNotifications();

  if (!supported) return null; // e.g. iOS Safari below 16.4, or non-standalone iOS

  return (
    <Card>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {subscribed ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('push.enable.title')}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {permission === 'denied'
                ? t('push.blocked')
                : subscribed
                  ? t('push.enabled')
                  : t('push.enable.description')}
            </p>
          </div>
        </div>
        {permission !== 'denied' && (
          <Button
            variant={subscribed ? 'outline' : 'primary'}
            size="sm"
            disabled={loading}
            onClick={subscribed ? unsubscribe : subscribe}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : subscribed ? t('push.disable.cta') : t('push.enable.cta')}
          </Button>
        )}
      </div>
    </Card>
  );
}
