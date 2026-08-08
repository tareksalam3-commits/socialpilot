import { useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { supabase } from '@/services/supabase';
import type { WorkspaceRole } from '@/utils/roles';

/** Resolves the signed-in user's role (`owner` | `manager` | `member`) within
 * their current workspace. Used to gate sensitive in-app actions (member
 * management, integrations, billing) without changing the app's overall
 * navigation or layout. */
export function useWorkspaceRole(): { role: WorkspaceRole | null; loading: boolean } {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const [role, setRole] = useState<WorkspaceRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!user || !workspace) {
      setRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace.id)
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setRole((data?.role as WorkspaceRole) ?? null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, workspace]);

  return { role, loading };
}
