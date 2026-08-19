import { supabase } from '@/lib/supabase';
import { callAiGateway } from '@/lib/api';
import type { AiGatewayResponse } from '@/lib/types';
import type { Lead, LeadCampaign, LeadCampaignMember, LeadIntakeRawInput, LeadListFilters, LeadSearchAnalysis, LeadSearchJob, LeadSearchMode, LeadSearchQuery, LeadSearchStats, LeadSortBy, LeadSource, LeadTag } from '../types';

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
  searchMode?: LeadSearchMode;
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
      search_mode: params.searchMode ?? 'balanced',
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
  const [{ data, error }, { data: job }] = await Promise.all([
    supabase.from('lead_search_requests').select('total_found, valid_count, duplicate_count, invalid_count, qualified_count').eq('workspace_id', workspaceId).eq('id', searchRequestId).maybeSingle(),
    supabase.from('lead_search_jobs').select('rounds_completed,stop_reason,search_summary').eq('workspace_id', workspaceId).eq('search_request_id', searchRequestId).maybeSingle(),
  ]);
  if (error || !data) throw new Error('تعذر تحميل إحصاءات البحث.');
  const summary = (job?.search_summary ?? {}) as Record<string, unknown>;
  return {
    totalFound: Number(data.total_found ?? 0),
    valid: Number(data.valid_count ?? 0),
    duplicates: Number(data.duplicate_count ?? 0),
    invalid: Number(data.invalid_count ?? 0),
    qualified: Number(data.qualified_count ?? 0),
    verified: Number(summary.verified ?? 0),
    averageMatchScore: typeof summary.averageMatchScore === 'number' ? summary.averageMatchScore : null,
    averageDataQuality: typeof summary.averageDataQuality === 'number' ? summary.averageDataQuality : null,
    sourcesUsed: Array.isArray(summary.sourcesUsed) ? summary.sourcesUsed.map(String) : [],
    rounds: Number(job?.rounds_completed ?? summary.searchRounds ?? 0),
    stopReason: (job?.stop_reason as string | null | undefined) ?? (summary.stopReason as string | null | undefined) ?? null,
    aiProvidersUsed: Array.isArray(summary.aiProvidersUsed) ? summary.aiProvidersUsed.map(String) : [],
    aiModelsUsed: Array.isArray(summary.aiModelsUsed) ? summary.aiModelsUsed.map(String) : [],
    aiFallbacks: Number(summary.aiFallbacks ?? 0),
    aiFallbackLog: Array.isArray(summary.aiFallbackLog) ? summary.aiFallbackLog.map((item) => ({ provider: String(item?.provider ?? 'unknown'), model: String(item?.model ?? 'unknown'), error: String(item?.error ?? 'unknown') })) : [],
    strategiesUsed: Array.isArray(summary.strategiesUsed) ? summary.strategiesUsed.map(String) : [],
    categoriesUsed: Array.isArray(summary.categoriesUsed) ? summary.categoriesUsed.map(String) : [],
    enginesUsed: Array.isArray(summary.enginesUsed) ? summary.enginesUsed.map(String) : [],
    strongQueries: Array.isArray(summary.strongQueries) ? summary.strongQueries.map(String) : [],
    weakQueries: Array.isArray(summary.weakQueries) ? summary.weakQueries.map(String) : [],
    relevantRate: typeof summary.relevantRate === 'number' ? summary.relevantRate : null,
    qualifiedRate: typeof summary.qualifiedRate === 'number' ? summary.qualifiedRate : null,
    duplicateRate: typeof summary.duplicateRate === 'number' ? summary.duplicateRate : null,
    verificationRate: typeof summary.verificationRate === 'number' ? summary.verificationRate : null,
    sourceCapabilities: (summary.sourceCapabilities as Record<string, unknown> | undefined) ?? {},
  };
}

async function callLeadHunterFunction<T>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('lead-hunter', { body: payload });
  if (error) throw new Error('تعذر الوصول إلى خدمة البحث. سيتم إعادة المحاولة أو استخدام مصدر بديل.');
  return data as T;
}

// ---------------------------------------------------------------------------
// Lead Management — browsing/filtering/sorting ALL leads in the workspace,
// independent of any single search request. Server-side filtering + paging
// via PostgREST (RLS already scopes everything to the caller's workspace).
// ---------------------------------------------------------------------------

const LEAD_LIST_PAGE_SIZE = 30;

export async function listAllLeads(
  workspaceId: string,
  filters: LeadListFilters = {},
  page = 0,
  sortBy: LeadSortBy = 'updated_at',
): Promise<{ leads: Lead[]; total: number; pageSize: number }> {
  let query = supabase.from('leads').select('*', { count: 'exact' }).eq('workspace_id', workspaceId);
  if (!filters.includeDoNotContact) query = query.eq('do_not_contact', false);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.governorate) query = query.eq('governorate', filters.governorate);
  if (filters.city) query = query.eq('city', filters.city);
  if (filters.minQuality) query = query.gte('data_quality_score', filters.minQuality);
  if (filters.minScore) query = query.gte('lead_score', filters.minScore);
  if (filters.search && filters.search.trim()) {
    const term = filters.search.trim();
    query = query.or(`full_name.ilike.%${term}%,occupation.ilike.%${term}%,job_title.ilike.%${term}%`);
  }
  if (filters.tagId) {
    const { data: linked } = await supabase.from('lead_tag_links').select('lead_id').eq('workspace_id', workspaceId).eq('tag_id', filters.tagId);
    const ids = (linked ?? []).map((row) => row.lead_id as string);
    if (ids.length === 0) return { leads: [], total: 0, pageSize: LEAD_LIST_PAGE_SIZE };
    query = query.in('id', ids);
  }
  const from = page * LEAD_LIST_PAGE_SIZE;
  const { data, error, count } = await query
    .order(sortBy, { ascending: false, nullsFirst: false })
    .range(from, from + LEAD_LIST_PAGE_SIZE - 1);
  if (error) throw new Error('تعذر تحميل قائمة العملاء.');
  return { leads: (data ?? []) as Lead[], total: count ?? 0, pageSize: LEAD_LIST_PAGE_SIZE };
}

export async function listTags(workspaceId: string): Promise<LeadTag[]> {
  const { data, error } = await supabase.from('lead_tags').select('*').eq('workspace_id', workspaceId).order('name');
  if (error) throw new Error('تعذر تحميل الوسوم.');
  return (data ?? []) as LeadTag[];
}

export async function listCampaigns(workspaceId: string): Promise<LeadCampaign[]> {
  const { data, error } = await supabase
    .from('lead_campaigns')
    .select('*, lead_campaign_members(count)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('تعذر تحميل الحملات.');
  return (data ?? []).map((row) => {
    const members = (row as { lead_campaign_members?: Array<{ count: number }> }).lead_campaign_members;
    return { ...row, member_count: members?.[0]?.count ?? 0 } as LeadCampaign;
  });
}

export async function listCampaignMembers(workspaceId: string, campaignId: string): Promise<LeadCampaignMember[]> {
  const { data, error } = await supabase
    .from('lead_campaign_members')
    .select('*, lead:leads(*)')
    .eq('workspace_id', workspaceId)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('تعذر تحميل عملاء الحملة.');
  return (data ?? []) as LeadCampaignMember[];
}

// ---------------------------------------------------------------------------
// Intake — manual add + batch import (CSV/Excel/API/existing CRM/test), both
// go through the server-side normalize→validate→dedupe→quality→score pipeline.
// ---------------------------------------------------------------------------

export type LeadIntakeOutcome =
  | { status: 'accepted'; leadId: string; dataQuality: { score: number; reasons: string[] }; score: { score: number; priority: string; reasons: string[] } }
  | { status: 'duplicate'; duplicate: { leadId: string; matchType: string; confidence: string } }
  | { status: 'rejected'; errors: string[] };

export async function addLead(workspaceId: string, lead: LeadIntakeRawInput): Promise<LeadIntakeOutcome> {
  const result = await callLeadHunterFunction<{ result: LeadIntakeOutcome }>({ action: 'add_lead', workspace_id: workspaceId, lead });
  return result.result;
}

export async function importLeads(
  workspaceId: string,
  rows: LeadIntakeRawInput[],
  sourceType: 'csv' | 'excel' | 'api' | 'existing_crm' | 'test',
  sourceLabel?: string,
): Promise<{ totalFound: number; accepted: number; duplicates: number; rejected: number; rejectedDetails: Array<{ raw: LeadIntakeRawInput; errors: string[] }> }> {
  return callLeadHunterFunction({ action: 'import_leads', workspace_id: workspaceId, leads: rows, source_type: sourceType, source_url: sourceLabel ?? null });
}

export async function updateLead(workspaceId: string, leadId: string, patch: LeadIntakeRawInput): Promise<void> {
  await callLeadHunterFunction({ action: 'update_lead', workspace_id: workspaceId, lead_id: leadId, patch });
}

export async function updateLeadStatus(workspaceId: string, leadId: string, status: Lead['status']): Promise<void> {
  await callLeadHunterFunction({ action: 'update_status', workspace_id: workspaceId, lead_id: leadId, status });
}

export async function addLeadTag(workspaceId: string, leadId: string, tagName: string): Promise<void> {
  await callLeadHunterFunction({ action: 'add_tag', workspace_id: workspaceId, lead_id: leadId, tag_name: tagName });
}

export async function removeLeadTag(workspaceId: string, leadId: string, tagName: string): Promise<void> {
  await callLeadHunterFunction({ action: 'remove_tag', workspace_id: workspaceId, lead_id: leadId, tag_name: tagName });
}

export async function suppressLead(workspaceId: string, leadId: string, reason?: string): Promise<void> {
  await callLeadHunterFunction({ action: 'suppress_lead', workspace_id: workspaceId, lead_id: leadId, reason });
}

export async function unsuppressLead(workspaceId: string, leadId: string): Promise<void> {
  await callLeadHunterFunction({ action: 'unsuppress_lead', workspace_id: workspaceId, lead_id: leadId });
}

export async function createCampaign(workspaceId: string, campaign: { name: string; notes?: string | null }): Promise<LeadCampaign> {
  const result = await callLeadHunterFunction<{ campaign: LeadCampaign }>({ action: 'create_campaign', workspace_id: workspaceId, campaign });
  return result.campaign;
}

export async function addLeadsToCampaign(workspaceId: string, campaignId: string, leadIds: string[]): Promise<{ added: number; skippedDoNotContact: number }> {
  return callLeadHunterFunction({ action: 'add_leads_to_campaign', workspace_id: workspaceId, campaign_id: campaignId, lead_ids: leadIds });
}

export async function removeLeadFromCampaign(workspaceId: string, campaignId: string, leadId: string): Promise<void> {
  await callLeadHunterFunction({ action: 'remove_lead_from_campaign', workspace_id: workspaceId, campaign_id: campaignId, lead_id: leadId });
}

export async function updateCampaignMemberStatus(workspaceId: string, campaignId: string, leadId: string, status: LeadCampaignMember['status']): Promise<void> {
  await callLeadHunterFunction({ action: 'update_campaign_member', workspace_id: workspaceId, campaign_id: campaignId, lead_id: leadId, status });
}

export type LeadExportFormat = 'csv' | 'json' | 'xlsx' | 'pdf';

export type LeadExportScope =
  | { kind: 'selected'; leadIds: string[] }
  | { kind: 'filtered'; filters: LeadListFilters }
  | { kind: 'all' }
  | { kind: 'campaign'; campaignId: string };

/**
 * Exports leads either by explicit id list ("Selected") or by server-side
 * filter ("All" / "Current Filter" / "Qualified" / "High Score" / etc. —
 * the caller builds the LeadListFilters that represent that scope). The
 * edge function always returns the full set of export columns as JSON rows;
 * the actual CSV/XLSX/PDF file is built client-side (see leadExport.ts) so
 * formatting only needs to live in one place.
 */
export async function exportLeads(
  workspaceId: string,
  scope: LeadExportScope,
  format: LeadExportFormat,
  options: { campaignId?: string; searchRequestId?: string } = {},
): Promise<{ rows: Array<Record<string, unknown>>; count: number; suppressedCount: number; format: string }> {
  const body: Record<string, unknown> = {
    action: 'export_leads',
    workspace_id: workspaceId,
    format,
    campaign_id: options.campaignId ?? (scope.kind === 'campaign' ? scope.campaignId : null),
    search_request_id: options.searchRequestId ?? null,
  };
  if (scope.kind === 'selected') body.lead_ids = scope.leadIds;
  else if (scope.kind === 'filtered') body.filters = scope.filters;
  else if (scope.kind === 'campaign') body.filters = {};
  else body.filters = {}; // 'all' — no filter narrowing beyond workspace + suppression

  const result = await callLeadHunterFunction<{ content: string; count: number; suppressedCount: number; format: string }>(body);
  const rows = result.content ? (JSON.parse(result.content) as Array<Record<string, unknown>>) : [];
  return { rows, count: result.count, suppressedCount: result.suppressedCount, format: result.format };
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Turns the rows returned by exportLeads() into an actual downloaded file.
 * CSV/XLSX/JSON download directly; PDF opens the browser print dialog
 * ("Save as PDF") since no PDF-generation library is installed in this
 * project — see leadExport.ts for the rationale.
 */
export async function downloadExport(
  rows: Array<Record<string, unknown>>,
  format: LeadExportFormat,
  filenamePrefix = 'leads',
  filterSummary: string[] = [],
): Promise<void> {
  const { buildCsv, buildWorkbookBlob, buildPrintableReportHtml, openPrintableReport, sortForExport } = await import('./leadExport');
  const datedName = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}`;
  const typedRows = rows as Array<import('./leadExport').ExportRow>;

  if (format === 'xlsx') {
    const blob = await buildWorkbookBlob(typedRows);
    triggerBlobDownload(blob, `${datedName}.xlsx`);
    return;
  }
  if (format === 'pdf') {
    const html = buildPrintableReportHtml(typedRows, { filterSummary });
    openPrintableReport(html);
    return;
  }
  if (format === 'json') {
    const blob = new Blob([JSON.stringify(sortForExport(typedRows), null, 2)], { type: 'application/json' });
    triggerBlobDownload(blob, `${datedName}.json`);
    return;
  }
  // csv
  const csv = buildCsv(typedRows);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }); // BOM so Excel opens Arabic CSV correctly
  triggerBlobDownload(blob, `${datedName}.csv`);
}

export type { LeadSearchQuery };
