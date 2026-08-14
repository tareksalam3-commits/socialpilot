import { useEffect, useState } from 'react';
import { Download, Share, X as XIcon, PlusSquare } from 'lucide-react';
import { useLanguage } from '@/providers/LanguageProvider';
import { haptic } from '@/utils/haptics';

const DISMISSED_KEY = 'sp_install_prompt_dismissed_at';
const SNOOZE_DAYS = 14;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function wasRecentlyDismissed(): boolean {
  const raw = localStorage.getItem(DISMISSED_KEY);
  if (!raw) return false;
  const elapsedDays = (Date.now() - Number(raw)) / (1000 * 60 * 60 * 24);
  return elapsedDays < SNOOZE_DAYS;
}

/**
 * Bottom sheet nudging the user to add the app to their home screen. Chrome/
 * Android fires `beforeinstallprompt`, which we defer and trigger from our
 * own UI (native browser banners are inconsistent and easy to miss). iOS has
 * no such event, so we show Safari's manual "Share -> Add to Home Screen"
 * steps instead, only in Safari's own browser chrome (not already-installed).
 */
export function InstallPrompt() {
  const { t, dir } = useLanguage();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone() || wasRecentlyDismissed()) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    // iOS: no native event, so surface our own hint after the user has
    // engaged a little rather than immediately on first paint.
    let iosTimer: number | undefined;
    if (isIOS() && !isStandalone()) {
      iosTimer = window.setTimeout(() => {
        setShowIOSHint(true);
        setVisible(true);
      }, 20000);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      if (iosTimer) window.clearTimeout(iosTimer);
    };
  }, []);

  const dismiss = () => {
    haptic('light');
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    haptic('medium');
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') haptic('success');
    setDeferredPrompt(null);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-x-3 z-50 mx-auto max-w-md animate-scale-in rounded-2xl border border-slate-200 bg-white p-4 shadow-popover dark:border-slate-700 dark:bg-slate-800"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}
      dir={dir}
    >
      <button
        onClick={dismiss}
        className="absolute end-3 top-3 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
        aria-label={t('common.cancel')}
      >
        <XIcon className="h-4 w-4" />
      </button>
      <div className="flex items-start gap-3 pe-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
          <Download className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('install.title')}</p>
          {showIOSHint ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('install.iosStep1')} <Share className="mx-1 inline h-3.5 w-3.5 align-text-bottom" />
              {t('install.iosStep2')} <PlusSquare className="mx-1 inline h-3.5 w-3.5 align-text-bottom" />
              {t('install.iosStep3')}
            </p>
          ) : (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('install.description')}</p>
          )}
        </div>
      </div>
      {!showIOSHint && (
        <button
          onClick={install}
          className="press-effect mt-3 w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
        >
          {t('install.cta')}
        </button>
      )}
    </div>
  );
}
