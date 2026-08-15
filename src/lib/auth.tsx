import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Workspace } from './types';

type AuthState = {
  session: Session | null;
  user: User | null;
  workspace: Workspace | null;
  isSuperAdmin: boolean;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshWorkspace: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadWorkspace(userId: string): Promise<Workspace | null> {
    const { data: memberRow } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberRow?.workspace_id) {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', memberRow.workspace_id)
        .maybeSingle();
      return (ws as Workspace | null) ?? null;
    }

    const { data } = await supabase
      .from('workspaces')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as Workspace | null) ?? null;
  }

  async function ensureWorkspace(userId: string): Promise<Workspace | null> {
    const existing = await loadWorkspace(userId);
    if (existing) return existing;

    const { error } = await supabase.rpc('create_workspace_with_owner', {
      ws_name: 'مساحتي',
    });
    if (error) return null;

    return loadWorkspace(userId);
  }

  async function loadUserContext(currentUser: User) {
    const { data: adminData } = await supabase.rpc('is_super_admin', {
      check_uid: currentUser.id,
    });
    const admin = Boolean(adminData);
    setIsSuperAdmin(admin);

    // Super Admin is platform-level and intentionally has no Workspace.
    if (admin) {
      setWorkspace(null);
      return;
    }

    // Existing users without a Workspace are repaired automatically. New users
    // are normally provisioned by the database trigger in migration 0005.
    const ws = await ensureWorkspace(currentUser.id);
    setWorkspace(ws);
  }

  async function refreshWorkspace() {
    if (!user || isSuperAdmin) return;
    setWorkspace(await ensureWorkspace(user.id));
  }

  // Auth bootstrap intentionally runs once; the callback owns the current session flow.
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        await loadUserContext(data.session.user);
      } else {
        setIsSuperAdmin(false);
        setWorkspace(null);
      }
      if (mounted) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          await loadUserContext(newSession.user);
        } else {
          setIsSuperAdmin(false);
          setWorkspace(null);
        }
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signUp(email: string, password: string) {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    // Workspace creation is handled atomically by the database trigger. This
    // avoids duplicate Workspaces when Supabase returns an active session.
    return { error: null };
  }

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { error: null };
  }

  async function signOut() {
    await supabase.auth.signOut();
    setWorkspace(null);
    setIsSuperAdmin(false);
  }

  return (
    <AuthContext.Provider
      value={{ session, user, workspace, isSuperAdmin, loading, signUp, signIn, signOut, refreshWorkspace }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
