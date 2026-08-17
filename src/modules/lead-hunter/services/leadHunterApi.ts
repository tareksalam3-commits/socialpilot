import { supabase } from '@/lib/supabase';
import { callAiGateway } from '@/lib/api';
import type { AiGatewayResponse } from '@/lib/types';
import type { Lead, LeadSearchAnalysis, LeadSearchJob, LeadSearchQuery, LeadSearchStats, LeadSource } from '../types';

export type LeadHunterAiResult = {
  result: LeadSearchAnalysis;
  response: AiGatewayResponse;
};

export async function analyzeLeadQuery(workspaceId: string, rawQuery: string): Promise<LeadHunterAiResult> {
  const response = await callAiGateway({
    intent: 'understand_lead_query',
    workspaceId,
    message: rawQuery,
    context: { domain: 'lead_hunter', primary_use_case: 'life_insurance_lead_generation' },
  });
  return { response, result: response.result as unknown as LeadSearchAnalysis };
}

export async function listLeadSources(workspaceId: string): Promise<LeadSource[]> {
  const { data, error } = await supabase
    .from('lead_sources')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('priority', { ascending: true })
    .limit(100);
  if (error) throw new Error('تعذر تحميل مصادر البيانات.');
  return (data ?? []) as LeadSource[];
}

export async function createLeadSearch(params: {
  workspaceId: string;
  rawQuery: string;
  analysis: LeadSearchAnalysis;
}): Promise<{ requestId: string }> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('يجب تسجيل الدخول لبدء البحث.');

  const { data, error } = await supabase
    .from('lead_search_requests')
    .insert({
      workspace_id: params.workspaceId,
      user_id: userId,
      raw_query: params.rawQuery.trim(),
      parsed_query: params.analysis.query,
      requested_count: params.analysis.query.requestedCount,
      objective: params.analysis.query.objective,
      status: 'confirmed',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error('تعذر حفظ طلب البحث. حاول مرة أخرى.');

  const { error: filterError } = await supabase.from('lead_search_filters').insert({
    workspace_id: params.workspaceId,
    search_request_id: data.id,
    filters: params.analysis.query,
  });
  if (filterError) throw new Error('تعذر حفظ معايير البحث.');
  return { requestId: data.id as string };
}

export async function startLeadSearch(workspaceId: string, requestId: string): Promise<LeadSearchJob> {
  const result = await callLeadHunterFunction<{ job: LeadSearchJob }>({ action: 'start_search', workspace_id: workspaceId, search_request_id: requestId });
  return result.job;
}

export async function getLeadSearchJob(workspaceId: string, jobId: string): Promise<LeadSearchJob> {
  const { data, error } = await supabase
    .from('lead_search_jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', jobId)
    .maybeSingle();
  if (error || !data) throw new Error('تعذر تحميل حالة البحث.');
  return data as LeadSearchJob;
}

export async function listLeads(workspaceId: string, searchRequestId?: string): Promise<Lead[]> {
  let query = supabase
    .from('lead_search_results')
    .select('lead:leads(*)')
    .eq('workspace_id', workspaceId)
    .eq('inclusion_status', 'included')
    .order('rank', { ascending: true, nullsFirst: false })
    .limit(50);
  if (searchRequestId) query = query.eq('search_request_id', searchRequestId);
  const { data, error } = await query;
  if (error) throw new Error('تعذر تحميل العملاء.');
  return (data ?? []).map((row) => {
    const lead = (row as { lead: Lead | Lead[] }).lead;
    return Array.isArray(lead) ? lead[0] : lead;
  }).filter(Boolean) as Lead[];
}

export async function getLeadStats(workspaceId: string, searchRequestId: string): Promise<LeadSearchStats> {
  const { data, error } = await supabase
    .from('lead_search_requests')
    .select('total_found, valid_count, duplicate_count, invalid_count, qualified_count')
    .eq('workspace_id', workspaceId)
    .eq('id', searchRequestId)
    .maybeSingle();
  if (error || !data) throw new Error('تعذر تحميل إحصاءات البحث.');
  return {
    totalFound: Number(data.total_found ?? 0),
    valid: Number(data.valid_count ?? 0),
    duplicates: Number(data.duplicate_count ?? 0),
    invalid: Number(data.invalid_count ?? 0),
    qualified: Number(data.qualified_count ?? 0),
  };
}

async function callLeadHunterFunction<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('lead-hunter', { body: payload });
  if (error) throw new Error('تعذر الوصول إلى خدمة البحث. سيتم إعادة المحاولة أو استخدام مصدر بديل.');
  return data as T;
}

export type { LeadSearchQuery };
