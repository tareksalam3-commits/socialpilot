import { useState } from 'react';
import { Mail, Lock, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBanner } from '@/components/ui';

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const fn = mode === 'signin' ? signIn : signUp;
    const { error } = await fn(email, password);
    setBusy(false);
    if (error) setError(error);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 safe-top safe-bottom bg-gradient-to-b from-ink-950 via-ink-960 to-ink-950">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="flex flex-col items-center mb-10">
          <img
            src="/socialpilot-icon-transparent.png"
            alt="SocialPilot"
            className="w-16 h-16 rounded-2xl object-cover shadow-lg shadow-black/25 mb-4"
          />
          <h1 className="text-2xl font-bold text-ink-50">SocialPilot AI</h1>
          <p className="text-ink-400 text-sm mt-2 text-center">
            نظام ذكي لإدارة وتسويق المحتوى على السوشيال ميديا
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && <ErrorBanner message={error} />}

          <div className="relative">
            <Mail className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" size={18} />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="البريد الإلكتروني"
              className="w-full bg-ink-900 border border-ink-800 rounded-xl pr-10 pl-4 py-3 text-ink-100 placeholder:text-ink-500 focus:border-brand-500/50 focus:outline-none transition-colors"
            />
          </div>

          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500" size={18} />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="كلمة المرور"
              className="w-full bg-ink-900 border border-ink-800 rounded-xl pr-10 pl-4 py-3 text-ink-100 placeholder:text-ink-500 focus:border-brand-500/50 focus:outline-none transition-colors"
            />
          </div>

          <Button type="submit" disabled={busy} size="lg" className="mt-2">
            {busy ? 'جارٍ المعالجة...' : mode === 'signin' ? 'تسجيل الدخول' : 'إنشاء حساب'}
          </Button>
        </form>

        <button
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin');
            setError(null);
          }}
          className="w-full flex items-center justify-center gap-1.5 mt-6 text-ink-400 text-sm hover:text-ink-200 transition-colors"
        >
          {mode === 'signin' ? 'ليس لديك حساب؟ أنشئ حساب جديد' : 'لديك حساب بالفعل؟ سجّل دخول'}
          <ArrowLeft size={14} />
        </button>
      </div>
    </div>
  );
}
