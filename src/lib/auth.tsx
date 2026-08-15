import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Workspace } from './types';

type AuthState = {
  session: Session | null;
  user: User | null;
  workspace: Workspace | null;
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
  const [loading, setLoading] = useState(true);

  async function loadWorkspace(userId: string): Promise<Workspace | null> {
    // Find workspace where user is owner OR a member
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

    // Fallback: check if user owns a workspace directly
    const { data } = await supabase
      .from('workspaces')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as Workspace | null) ?? null;
  }

  async function refreshWorkspace() {
    if (user) {
      const ws = await loadWorkspace(user.id);
      setWorkspace(ws);
    }
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        loadWorkspace(data.session.user.id).then((ws) => {
          if (mounted) {
            setWorkspace(ws);
            setLoading(false);
          }
        });
      } else {
        setLoading(false);
      }
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      (async () => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          const ws = await loadWorkspace(newSession.user.id);
          setWorkspace(ws);
        } else {
          setWorkspace(null);
        }
        setLoading(false);
      })();
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signUp(email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { error: error.message };
    if (data.user) {
      const { error: rpcError } = await supabase.rpc('create_workspace_with_owner', {
        ws_name: 'مساحتي',
      });
      if (rpcError) return { error: rpcError.message };
    }
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
  }

  return (
    <AuthContext.Provider
      value={{ session, user, workspace, loading, signUp, signIn, signOut, refreshWorkspace }}
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
