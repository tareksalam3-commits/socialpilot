import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button, Input } from '@/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { validateEmail, validatePassword, validateRequired, validateMatch } from '@/utils/validation';

export function RegisterPage() {
  const { signUp } = useAuth();
  const { push } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ fullName?: string; email?: string; password?: string; confirm?: string }>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nameErr = validateRequired(fullName, t('auth.fullName'), t);
    const emailErr = validateEmail(email, t);
    const passErr = validatePassword(password, t);
    const matchErr = validateMatch(password, confirm, t('auth.confirmPassword'), t);
    setErrors({
      fullName: nameErr.error,
      email: emailErr.error,
      password: passErr.error,
      confirm: matchErr.error,
    });
    if (!nameErr.valid || !emailErr.valid || !passErr.valid || !matchErr.valid) return;

    setLoading(true);
    const { error } = await signUp(email, password, fullName);
    setLoading(false);
    if (error) {
      push({ title: t('auth.toast.signUpFailed'), description: error, variant: 'error' });
      return;
    }
    push({
      title: t('auth.toast.accountCreated'),
      description: t('auth.toast.accountCreatedDesc'),
      variant: 'success',
    });
    navigate('/app/dashboard');
  };

  return (
    <AuthLayout>
      <div className="mb-8 flex items-center gap-2 lg:hidden">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="text-lg font-semibold text-slate-900 dark:text-white">SocialPilot AI</span>
      </div>
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.register.title')}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auth.register.subtitle')}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
        <Input
          label={t('auth.fullName')}
          name="fullName"
          autoComplete="name"
          placeholder={t('auth.fullNamePlaceholder')}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
        />
        <Input
          label={t('auth.email')}
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Input
          label={t('auth.password')}
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder={t('auth.passwordMinPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Input
          label={t('auth.confirmPassword')}
          type="password"
          name="confirm"
          autoComplete="new-password"
          placeholder={t('auth.confirmPasswordPlaceholder')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
        />
        <Button type="submit" loading={loading} className="w-full">
          {t('auth.register.button')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('auth.register.haveAccount')}{' '}
        <Link to="/login" className="font-semibold text-slate-900 hover:underline dark:text-white">
          {t('auth.login.button')}
        </Link>
      </p>
    </AuthLayout>
  );
}
