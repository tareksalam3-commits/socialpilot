import { supabase } from '@/services/supabase';
import type { Workspace } from '@/types/database';

export const workspaceRepository = {
  async getByOwner(ownerId: string): Promise<Workspace | null> {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (error) throw error;
    return data as Workspace | null;
  },

  // Added for Phase 2 (Workspace Context / STEP 2): the Context Builder
  // needs to load a workspace by id, not just by the current owner.
  async getById(id: string): Promise<Workspace | null> {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as Workspace | null;
  },

  async create(input: {
    name: string;
    brand_name?: string | null;
    language?: string;
    country?: string;
  }): Promise<Workspace> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('workspaces')
      .insert({
        name: input.name,
        brand_name: input.brand_name ?? null,
        timezone: 'Africa/Cairo',
        language: input.language ?? 'ar',
        country: input.country ?? 'EG',
        owner_id: user.id,
      })
      .select()
      .single();
    if (error) throw error;
    return data as Workspace;
  },

  async update(id: string, patch: Partial<Workspace>): Promise<Workspace> {
    const { data, error } = await supabase
      .from('workspaces')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Workspace;
  },
};
