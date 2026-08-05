import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/services/supabase';
import { useLanguage } from '@/providers/LanguageProvider';
import type { Profile } from '@/types/database';

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type TFunction = (key: string, params?: Record<string, string | number>) => string;

function mapAuthError(message: string, t: TFunction): string {
  if (message.includes('Invalid login credentials')) return t('auth.error.invalidCredentials');
  if (message.includes('already registered')) return t('auth.error.emailExists');
  if (message.includes('Password should be at least')) return t('validation.password.minLength', { count: 6 });
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('Failed to load profile:', error.message);
      return;
    }
    setProfile(data as Profile | null);
  };

  useEffect(() => {
    let mounted = true;

    // Safety net: on a slow/flaky connection getSession() can hang (or
    // reject) indefinitely, leaving the app stuck on "checking session"
    // forever. Force loading to resolve after 10s no matter what.
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 10000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        if (data.session?.user) {
          loadProfile(data.session.user.id).finally(() => {
            clearTimeout(timeout);
            if (mounted) setLoading(false);
          });
        } else {
          clearTimeout(timeout);
          setLoading(false);
        }
      })
      .catch((error) => {
        console.error('Failed to get session:', error);
        clearTimeout(timeout);
        if (mounted) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        setSession(newSession);
        if (newSession?.user) {
          await loadProfile(newSession.user.id);
        } else {
          setProfile(null);
        }
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      clearTimeout(timeout);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) return { error: mapAuthError(error.message, t) };
    // If email confirmation is disabled, Supabase returns a session immediately.
    if (data.session?.user) {
      setSession(data.session);
      await loadProfile(data.session.user.id);
      setLoading(false);
    }
    return { error: null };
  };

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: mapAuthError(error.message, t) };
    // Set session + profile here (instead of waiting for the async
    // onAuthStateChange event) so that by the time this resolves and the
    // caller navigates, `user`/`profile` are already committed — avoids a
    // race where ProtectedRoute reads stale state right after navigation.
    if (data.session?.user) {
      setSession(data.session);
      await loadProfile(data.session.user.id);
    }
    setLoading(false);
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
  };

  const refreshProfile = async () => {
    if (session?.user) await loadProfile(session.user.id);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signUp,
      signIn,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
