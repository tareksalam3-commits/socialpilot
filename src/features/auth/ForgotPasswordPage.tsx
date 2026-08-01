import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button, Input, SuccessAlert } from '@/ui';
import { supabase } from '@/services/supabase';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { validateEmail } from '@/utils/validation';

export function ForgotPasswordPage() {
  const { push } = useToast();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email);
    setError(emailErr.error);
    if (!emailErr.valid) return;

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      push({ title: t('auth.forgotPassword.toastFailed'), description: error.message, variant: 'error' });
      return;
    }
    setSent(true);
  };

  return (
    <AuthLayout>
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="text-lg font-semibold text-slate-900 dark:text-white">SocialPilot AI</span>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.forgotPassword.title')}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {t('auth.forgotPassword.subtitle')}
      </p>

      {sent ? (
        <div className="mt-8 space-y-4">
          <SuccessAlert
            title={t('auth.forgotPassword.checkInbox')}
            description={t('auth.forgotPassword.checkInboxDesc')}
          />
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> {t('auth.forgotPassword.backToSignIn')}
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <Input
            label={t('auth.email')}
            type="email"
            name="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          <Button type="submit" loading={loading} className="w-full">
            {t('auth.forgotPassword.sendButton')}
          </Button>
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" /> {t('auth.forgotPassword.backToSignIn')}
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
