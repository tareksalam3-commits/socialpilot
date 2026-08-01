import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
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
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const passErr = validatePassword(password);
    const matchErr = validateMatch(password, confirm, 'Passwords');
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

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <Input
          label={t('auth.resetPassword.newPassword')}
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Input
          label={t('auth.resetPassword.confirmNewPassword')}
          type="password"
          name="confirm"
          autoComplete="new-password"
          placeholder="Re-enter your password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <Button type="submit" loading={loading} className="w-full">
          {t('auth.resetPassword.button')}
        </Button>
      </form>
    </AuthLayout>
  );
}
