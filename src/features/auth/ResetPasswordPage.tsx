import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button, Input } from '@/ui';
import { supabase } from '@/services/supabase';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { validatePassword, validateMatch } from '@/utils/validation';

export function ResetPasswordPage() {
  const { push } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [loading, setLoading] = useState(false);
  const [exchangeError, setExchangeError] = useState<string | null>(null);
  const [exchanging, setExchanging] = useState(true);

  // Exchange the recovery token_hash for a session when the user arrives via
  // the reset-password email link. Supabase appends ?type=recovery&token_hash=…
  // to the redirect URL; we must call exchangeCodeForSession before the user
  // can update their password.
  useEffect(() => {
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');

    if (type !== 'recovery' || !tokenHash) {
      // Not a valid recovery link — skip exchange and let the form handle it
      setExchanging(false);
      return;
    }

    const exchange = async () => {
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(
          new URLSearchParams({ code: tokenHash }).toString(),
        );
        if (error) {
          setExchangeError(error.message || t('auth.resetPassword.invalidLink'));
        } else {
          setExchangeError(null);
        }
      } catch (err: unknown) {
        // Older Supabase JS versions throw when exchangeCodeForSession is called
        // without a code verifier in the URL — in that case the session may
        // already be established by detectSessionInUrl, so just continue.
        setExchangeError(null);
      } finally {
        setExchanging(false);
      }
    };

    exchange();
  }, [searchParams, t]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const passErr = validatePassword(password, t);
    const matchErr = validateMatch(password, confirm, t('auth.resetPassword.confirmNewPassword'), t);
    setErrors({ password: passErr.error, confirm: matchErr.error });
    if (!passErr.valid || !matchErr.valid) return;

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      push({ title: t('auth.resetPassword.toastFailed'), description: error.message, variant: 'error' });
      return;
    }
    push({ title: t('auth.resetPassword.toastSuccess'), description: t('auth.resetPassword.toastSuccessDesc'), variant: 'success' });
    navigate('/login');
  };

  return (
    <AuthLayout>
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="text-lg font-semibold text-slate-900 dark:text-white">SocialPilot AI</span>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.resetPassword.title')}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auth.resetPassword.subtitle')}</p>

      {exchanging ? (
        <div className="mt-8 space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-500 dark:border-t-white" />
            <span className="text-sm text-slate-600 dark:text-slate-300">{t('auth.resetPassword.verifying')}</span>
          </div>
        </div>
      ) : exchangeError ? (
        <div className="mt-8 space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('auth.resetPassword.invalidLink')}</p>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{exchangeError}</p>
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => navigate('/forgot-password')}
          >
            {t('auth.resetPassword.requestNewLink')}
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Input
            label={t('auth.resetPassword.newPassword')}
            type="password"
            name="password"
            autoComplete="new-password"
            placeholder={t('auth.passwordMinPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
          />
          <Input
            label={t('auth.resetPassword.confirmNewPassword')}
            type="password"
            name="confirm"
            autoComplete="new-password"
            placeholder={t('auth.confirmPasswordPlaceholder')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            error={errors.confirm}
          />
          <Button type="submit" loading={loading} className="w-full">
            {t('auth.resetPassword.button')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
