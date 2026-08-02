import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { AuthLayout } from '@/layouts/AuthLayout';
import { Button, Input } from '@/ui';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { validateEmail, validatePassword } from '@/utils/validation';

export function LoginPage() {
  const { signIn } = useAuth();
  const { push } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const emailErr = validateEmail(email, t);
    const passErr = validatePassword(password, t);
    setErrors({ email: emailErr.error, password: passErr.error });
    if (!emailErr.valid || !passErr.valid) return;

    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      push({ title: t('auth.toast.signInFailed'), description: error, variant: 'error' });
      return;
    }
    push({ title: t('auth.toast.welcomeBack'), variant: 'success' });
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
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{t('auth.login.title')}</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('auth.login.subtitle')}</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-4">
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
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            {t('auth.login.forgotPassword')}
          </Link>
        </div>
        <Button type="submit" loading={loading} className="w-full">
          {t('auth.login.button')}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {t('auth.login.noAccount')}{' '}
        <Link to="/register" className="font-semibold text-slate-900 hover:underline dark:text-white">
          {t('auth.register.button')}
        </Link>
      </p>
    </AuthLayout>
  );
}
