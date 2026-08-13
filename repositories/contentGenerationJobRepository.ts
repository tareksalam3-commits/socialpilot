import { supabase } from '@/services/supabase';
import type { CampaignPlan, AudienceInference } from '@/types/assistant';
import type { Post } from '@/types/social';

type PersistedCampaignJob = {
  id: string;
  workspace_id: string;
  user_id: string;
  status: 'queued' | 'collecting' | 'creating' | 'completed' | 'cancelled';
  phase: 'planning' | 'audience' | 'queued' | 'collecting' | 'creating' | 'quality' | 'review' | 'completed' | 'cancelled';
  request_text: string;
  plan: CampaignPlan;
  post_count: number;
  next_index: number;
  images_enabled: boolean;
  audience_inference: AudienceInference | null;
  schedule_times: string[];
  used_sources: Array<{ source_id: string; source_name: string | null; title: string }>;
  last_error: string | null;
  conversation_id: string | null;
  updated_at: string;
};

function rowToJob(row: Record<string, unknown>): PersistedCampaignJob {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    user_id: String(row.user_id),
    status: row.status as PersistedCampaignJob['status'],
    phase: row.phase as PersistedCampaignJob['phase'],
    request_text: String(row.request_text ?? ''),
    plan: (row.plan ?? {}) as CampaignPlan,
    post_count: Number(row.post_count ?? 0),
    next_index: Number(row.next_index ?? 0),
    images_enabled: row.images_enabled === true,
    audience_inference: (row.audience_inference ?? null) as AudienceInference | null,
    schedule_times: Array.isArray(row.schedule_times) ? row.schedule_times.filter((value): value is string => typeof value === 'string') : [],
    used_sources: Array.isArray(row.used_sources) ? row.used_sources as PersistedCampaignJob['used_sources'] : [],
    last_error: typeof row.last_error === 'string' ? row.last_error : null,
    conversation_id: typeof row.conversation_id === 'string' ? row.conversation_id : null,
    updated_at: String(row.updated_at ?? ''),
  };
}

export const contentGenerationJobRepository = {
  async enqueue(input: {
    workspaceId: string;
    userId: string;
    requestText: string;
    plan: CampaignPlan;
    audienceInference: AudienceInference | null;
    imagesEnabled: boolean;
    scheduleTimes: string[];
    conversationId: string | null;
    aiModel?: string;
    aiTemperature?: number;
    aiMaxTokens?: number;
  }): Promise<PersistedCampaignJob> {
    const { data, error } = await supabase
      .from('content_generation_jobs')
      .insert({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        status: 'queued',
        phase: 'queued',
        request_text: input.requestText,
        plan: input.plan,
        post_count: input.plan.post_count,
        audience_inference: input.audienceInference,
        images_enabled: input.imagesEnabled,
        schedule_times: input.scheduleTimes,
        conversation_id: input.conversationId,
        ai_model: input.aiModel ?? null,
        ai_temperature: input.aiTemperature ?? null,
        ai_max_tokens: input.aiMaxTokens ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return rowToJob(data as Record<string, unknown>);
  },

  async latestActive(workspaceId: string, userId: string): Promise<PersistedCampaignJob | null> {
    const { data, error } = await supabase
      .from('content_generation_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .neq('status', 'cancelled')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToJob(data as Record<string, unknown>) : null;
  },

  async generatedPosts(workspaceId: string, jobId: string): Promise<Post[]> {
    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .contains('metadata', { content_generation_job_id: jobId })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Post[];
  },

  /**
   * تجاهل الحملة: تُستدعى عند ضغط المستخدم "تجاهل" في شاشة المراجعة. لا
   * يكفي مسح الحالة محليًا فقط — طالما تبقى الحالة في قاعدة البيانات غير
   * "cancelled"، سيعيد فحص latestActive (كل 10 ثوانٍ) إحضار نفس الحملة
   * ويعرضها من جديد في شاشة المراجعة. لذلك نحذف أولاً المسودات غير
   * المعتمدة التابعة لهذه الحملة، ثم نضع status/phase = 'cancelled' حتى
   * يستبعدها latestActive نهائيًا.
   */
  async discard(jobId: string, workspaceId: string): Promise<void> {
    const { error: deleteError } = await supabase
      .from('posts')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('status', 'draft')
      .contains('metadata', { content_generation_job_id: jobId });
    if (deleteError) throw deleteError;

    const { error: cancelError } = await supabase
      .from('content_generation_jobs')
      .update({ status: 'cancelled', phase: 'cancelled' })
      .eq('id', jobId);
    if (cancelError) throw cancelError;
  },
};

export type { PersistedCampaignJob };
