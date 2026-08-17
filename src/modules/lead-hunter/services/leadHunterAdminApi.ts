import { supabase } from '@/lib/supabase';

export type LeadHunterAdminResponse = Record<string, unknown>;

export async function callLeadHunterAdmin<T extends LeadHunterAdminResponse = LeadHunterAdminResponse>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('يجب تسجيل الدخول إلى Super Admin.');
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lead-hunter-admin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'تعذر تنفيذ العملية الإدارية.');
  return body;
}

export const leadHunterAdmin = {
  overview: () => callLeadHunterAdmin<{ overview: Record<string, number | null> }>('overview'),
  health: () => callLeadHunterAdmin<{ services: Array<Record<string, unknown>>; sources: Array<Record<string, unknown>> }>('health'),
  settings: () => callLeadHunterAdmin<{ settings: Record<string, unknown> | null; scoring: Record<string, unknown> | null }>('get_settings'),
  updateSettings: (settings: Record<string, unknown>) => callLeadHunterAdmin<{ settings: Record<string, unknown> }>('update_settings', { settings }),
  updateScoring: (scoring: Record<string, unknown>) => callLeadHunterAdmin<{ scoring: Record<string, unknown> }>('update_scoring', { scoring }),
  sources: () => callLeadHunterAdmin<{ sources: Array<Record<string, unknown>> }>('list_sources'),
  saveSource: (source: Record<string, unknown>, apiKey?: string) => callLeadHunterAdmin<{ source: Record<string, unknown> }>('save_source', { source, api_key: apiKey }),
  toggleSource: (sourceId: string, enabled: boolean) => callLeadHunterAdmin('toggle_source', { source_id: sourceId, enabled }),
  testSource: (sourceId: string) => callLeadHunterAdmin<{ ok: boolean; status: string; message: string }>('test_source', { source_id: sourceId }),
  deleteSource: (sourceId: string) => callLeadHunterAdmin('delete_source', { source_id: sourceId }),
  jobs: () => callLeadHunterAdmin<{ jobs: Array<Record<string, unknown>> }>('list_jobs'),
  jobAction: (jobId: string, jobAction: string) => callLeadHunterAdmin('job_action', { job_id: jobId, job_action: jobAction }),
  leads: () => callLeadHunterAdmin<{ leads: Array<Record<string, unknown>> }>('list_leads'),
  leadAction: (leadId: string, leadAction: string, workspaceId?: string) => callLeadHunterAdmin('lead_action', { lead_id: leadId, lead_action: leadAction, workspace_id: workspaceId }),
  suppression: () => callLeadHunterAdmin<{ suppression: Array<Record<string, unknown>> }>('list_suppression'),
  campaigns: () => callLeadHunterAdmin<{ campaigns: Array<Record<string, unknown>> }>('list_campaigns'),
  exports: () => callLeadHunterAdmin<{ exports: Array<Record<string, unknown>> }>('list_exports'),
  usage: () => callLeadHunterAdmin<{ usage: Array<Record<string, unknown>> }>('list_usage'),
  logs: () => callLeadHunterAdmin<{ logs: Array<Record<string, unknown>> }>('list_logs'),
  errors: () => callLeadHunterAdmin<{ errors: Array<Record<string, unknown>> }>('list_errors'),
  resolveError: (errorId: string, action: 'resolved' | 'ignored') => callLeadHunterAdmin('resolve_error', { error_id: errorId, error_action: action }),
  prompts: () => callLeadHunterAdmin<{ prompts: Array<Record<string, unknown>> }>('list_prompts'),
  savePrompt: (prompt: Record<string, unknown>) => callLeadHunterAdmin<{ prompt: Record<string, unknown> }>('save_prompt', { prompt }),
  permissions: () => callLeadHunterAdmin<{ permissions: Array<Record<string, unknown>> }>('list_permissions'),
  workspaces: () => callLeadHunterAdmin<{ workspaces: Array<Record<string, unknown>> }>('list_workspaces'),
  limits: () => callLeadHunterAdmin<{ limits: Array<Record<string, unknown>> }>('list_limits'),
};
