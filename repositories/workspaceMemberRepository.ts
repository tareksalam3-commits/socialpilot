import { supabase } from '@/services/supabase';
import type { WorkspaceMember } from '@/types/database';
import type { WorkspaceInvitation } from '@/types/social';

export const workspaceMemberRepository = {
  async list(workspaceId: string): Promise<(WorkspaceMember & { full_name: string | null })[]> {
    const { data, error } = await supabase
      .from('workspace_members')
      .select('*, profiles!workspace_members_user_id_fkey(full_name)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const members = (data ?? []) as (WorkspaceMember & { profiles?: { full_name: string | null } })[];
    return members.map((m) => ({
      ...m,
      full_name: m.profiles?.full_name ?? null,
    }));
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('workspace_members').delete().eq('id', id);
    if (error) throw error;
  },

  async updateRole(id: string, role: string): Promise<void> {
    const { error } = await supabase.from('workspace_members').update({ role }).eq('id', id);
    if (error) throw error;
  },
};

export const invitationRepository = {
  async list(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const { data, error } = await supabase
      .from('workspace_invitations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as WorkspaceInvitation[];
  },

  async create(input: { workspace_id: string; email: string; role?: string }): Promise<WorkspaceInvitation> {
    const { data: userData } = await supabase.auth.getUser();
    const token = crypto.randomUUID();
    const { data, error } = await supabase
      .from('workspace_invitations')
      .insert({
        workspace_id: input.workspace_id,
        email: input.email,
        role: input.role ?? 'member',
        invited_by: userData.user!.id,
        token,
      })
      .select()
      .single();
    if (error) throw error;
    return data as WorkspaceInvitation;
  },

  async revoke(id: string): Promise<void> {
    const { error } = await supabase.from('workspace_invitations').update({ status: 'revoked' }).eq('id', id);
    if (error) throw error;
  },
};

export const activityRepository = {
  async list(workspaceId: string, limit = 30): Promise<{ id: string; type: string; description: string; metadata: Record<string, unknown>; created_at: string; user_id: string }[]> {
    const { data, error } = await supabase
      .from('activities')
      .select('id,type,description,metadata,created_at,user_id')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as { id: string; type: string; description: string; metadata: Record<string, unknown>; created_at: string; user_id: string }[];
  },

  async create(input: { workspace_id: string; type: string; description: string; metadata?: Record<string, unknown> }): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    await supabase.from('activities').insert({
      workspace_id: input.workspace_id,
      user_id: userData.user!.id,
      type: input.type,
      description: input.description,
      metadata: input.metadata ?? {},
    });
  },
};
