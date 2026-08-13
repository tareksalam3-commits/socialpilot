import { supabase } from '@/services/supabase';
import type { AudienceProfile } from '@/types/ai';

// Mirrors brandVoiceRepository.ts exactly — one row per workspace, seeded
// by the on_workspace_ai_setup trigger, so `update` is always safe to call
// without checking for a row first.
export const audienceProfileRepository = {
  async get(workspaceId: string): Promise<AudienceProfile | null> {
    const { data, error } = await supabase
      .from('audience_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data as AudienceProfile | null;
  },

  async update(workspaceId: string, patch: Partial<AudienceProfile>): Promise<AudienceProfile> {
    const { data, error } = await supabase
      .from('audience_profiles')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .select()
      .single();
    if (error) throw error;
    return data as AudienceProfile;
  },
};
