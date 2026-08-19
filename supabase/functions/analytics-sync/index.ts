import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
const META_GRAPH_VERSION = Deno.env.get('META_GRAPH_VERSION') ?? 'v26.0';
const LINKEDIN_API_VERSION = Deno.env.get('LINKEDIN_API_VERSION') ?? '202607';
const LINKEDIN_RESTLI_PROTOCOL_VERSION = '2.0.0';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Job = {
  id: string;
  workspace_id: string;
  variant_id: string | null;
  calendar_item_id: string | null;
  external_post_id: string | null;
  platform: string | null;
  published_at: string | null;
  status?: string | null;
  last_attempt_at?: string | null;
  created_at?: string | null;
};

type Account = {
  id: string;
  external_id?: string | null;
  page_id?: string | null;
  ig_user_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

type InsightRow = {
  workspace_id: string;
  content_id: string | null;
  variant_id: string | null;
  publishing_job_id: string;
  metric: string;
  value: number;
  timestamp: string;
  platform: string;
  external_post_id: string;
  source: string;
  fetched_at: string;
};

async function fetchWithRetry(input: string | URL, init: RequestInit, maxAttempts = 3): Promise<Response> {
  let response: Response | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    response = await fetch(input, init);
    const retryable = response.status === 429 || response.status >= 500;
    if (response.ok || !retryable || attempt === maxAttempts) return response;
    const retryAfter = Number(response.headers.get('retry-after') ?? 0);
    const waitMs = Math.min(5_000, retryAfter > 0 ? retryAfter * 1_000 : 250 * (2 ** (attempt - 1)));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return response as Response;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const message = [record.message, record.error_description, record.detail, record.hint, record.code]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (message) return message;
  }
  return 'sync failed';
}

async function readJsonResponse(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error;
    const errorMessageValue = typeof error === 'string'
      ? error
      : error && typeof error === 'object'
        ? (error as Record<string, unknown>).message
        : undefined;
    const detail = typeof body.detail === 'string' ? body.detail : typeof body.title === 'string' ? body.title : undefined;
    const topLevelMessage = typeof body.message === 'string' ? body.message : undefined;
    const serviceErrorCode = typeof body.serviceErrorCode === 'number' || typeof body.serviceErrorCode === 'string'
      ? String(body.serviceErrorCode)
      : undefined;
    const message = String(errorMessageValue ?? detail ?? topLevelMessage ?? fallback);
    throw new Error(`${fallback} (${response.status}${serviceErrorCode ? `/${serviceErrorCode}` : ''}): ${message}`);
  }
  return body;
}

async function graphGet(path: string, accessToken: string, params: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const url = new URL(`https://graph.facebook.com/${path}`);
  for (const [key, value] of Object.entries({ ...params, access_token: accessToken })) url.searchParams.set(key, value);
  const response = await fetchWithRetry(url.toString(), { headers: { Accept: 'application/json' } });
  return readJsonResponse(response, 'Meta Graph API request failed');
}

async function markAccountExpired(accountId: string): Promise<void> {
  await supabase.from('social_accounts').update({ status: 'expired', needs_reconnect: true }).eq('id', accountId);
}

async function accessTokenFor(account: Account, label: string): Promise<string> {
  const { data: token } = await supabase
    .from('social_account_tokens')
    .select('access_token,refresh_token,expires_at')
    .eq('account_id', account.id)
    .maybeSingle();
  if (!token?.access_token) throw new Error(`${label} account token missing`);
  if (token.expires_at && new Date(token.expires_at).getTime() < Date.now() + 60_000) {
    await markAccountExpired(account.id);
    throw new Error(`${label} token expired; reconnect the account`);
  }
  return String(token.access_token);
}

async function xToken(accountId: string): Promise<string> {
  const { data: token } = await supabase.from('social_account_tokens').select('access_token,refresh_token,expires_at').eq('account_id', accountId).maybeSingle();
  if (!token?.access_token) throw new Error('X account token missing');
  const expired = token.expires_at && new Date(token.expires_at).getTime() < Date.now() + 60_000;
  if (!expired) return token.access_token;
  if (!token.refresh_token) throw new Error('X token expired and cannot be refreshed');
  const { data: app } = await supabase.from('social_platform_apps').select('app_id').eq('platform_key', 'x').maybeSingle();
  const { data: secret } = await supabase.from('social_platform_app_secrets').select('app_secret').eq('platform_key', 'x').maybeSingle();
  if (!app?.app_id || !secret?.app_secret) throw new Error('X OAuth configuration incomplete');
  const response = await fetchWithRetry('https://api.twitter.com/2/oauth2/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${app.app_id}:${secret.app_secret}`)}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: app.app_id }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body?.error_description ?? 'X token refresh failed');
  await supabase.from('social_account_tokens').update({ access_token: body.access_token, refresh_token: body.refresh_token ?? token.refresh_token, expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null, updated_at: new Date().toISOString() }).eq('account_id', accountId);
  return body.access_token;
}

async function getAccount(workspaceId: string, platform: string): Promise<Account> {
  const { data: account, error } = await supabase
    .from('social_accounts')
    .select('id,external_id,page_id,ig_user_id,metadata')
    .eq('workspace_id', workspaceId)
    .eq('platform', platform)
    .eq('status', 'connected')
    .maybeSingle();
  if (error || !account) throw new Error(`No connected ${platform} account`);
  return account as Account;
}

async function variantContext(job: Job): Promise<{ contentId: string | null }> {
  if (!job.variant_id) return { contentId: null };
  const { data: variant } = await supabase.from('content_variants').select('content_id').eq('id', job.variant_id).maybeSingle();
  return { contentId: variant?.content_id ?? null };
}

async function upsertRows(rows: InsightRow[]): Promise<number> {
  if (!rows.length) return 0;
  const { error } = await supabase.from('post_insights').upsert(rows, { onConflict: 'workspace_id,external_post_id,platform,metric,timestamp', ignoreDuplicates: false });
  if (error) throw error;
  return rows.length;
}

function makeRow(job: Job, contentId: string | null, platform: string, source: string, metric: string, value: unknown, timestamp: string): InsightRow | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return {
    workspace_id: job.workspace_id,
    content_id: contentId,
    variant_id: job.variant_id,
    publishing_job_id: job.id,
    metric,
    value: numeric,
    timestamp,
    platform,
    external_post_id: job.external_post_id as string,
    source,
    fetched_at: new Date().toISOString(),
  };
}

function auditPostId(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const value = (detail as Record<string, unknown>).post_id;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function auditPlatform(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const value = (detail as Record<string, unknown>).platform;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function reconcilePublishedJobs(workspaceId: string): Promise<{ reconciled: number; evidence: number }> {
  const { data: audits, error: auditsError } = await supabase
    .from('audit_logs')
    .select('entity_id,detail,created_at')
    .eq('workspace_id', workspaceId)
    .eq('action', 'publish_succeeded')
    .eq('entity', 'content_variants')
    .order('created_at', { ascending: false })
    .limit(200);
  if (auditsError) throw auditsError;

  const evidence = (audits ?? []).filter((audit) => Boolean(auditPostId(audit.detail) && auditPlatform(audit.detail))).length;
  if (!audits?.length) return { reconciled: 0, evidence };

  const { data: jobs, error: jobsError } = await supabase
    .from('publishing_jobs')
    .select('id,workspace_id,variant_id,calendar_item_id,external_post_id,platform,published_at,status,last_attempt_at,created_at')
    .eq('workspace_id', workspaceId)
    .neq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(200);
  if (jobsError) throw jobsError;

  const remaining = [...(jobs as Job[] ?? [])];
  let reconciled = 0;
  for (const audit of audits) {
    const externalPostId = auditPostId(audit.detail);
    const platform = auditPlatform(audit.detail);
    if (!externalPostId || !platform || !audit.entity_id) continue;

    const candidateIndex = remaining.findIndex((job) => job.variant_id === audit.entity_id && !job.external_post_id && (!job.platform || job.platform === platform));
    if (candidateIndex < 0) continue;
    const job = remaining[candidateIndex];
    remaining.splice(candidateIndex, 1);
    const publishedAt = String(audit.created_at ?? job.published_at ?? job.last_attempt_at ?? new Date().toISOString());
    const { error: updateError } = await supabase.from('publishing_jobs').update({
      status: 'succeeded',
      completed_at: publishedAt,
      published_at: publishedAt,
      last_attempt_at: publishedAt,
      external_post_id: externalPostId,
      platform,
      last_error: null,
      result: { platform, post_id: externalPostId, source: 'publish_succeeded_audit' },
    }).eq('id', job.id);
    if (updateError) throw updateError;

    if (job.calendar_item_id) await supabase.from('calendar_items').update({ status: 'published' }).eq('id', job.calendar_item_id);
    if (job.variant_id) {
      const context = await variantContext(job);
      if (context.contentId) await supabase.from('content').update({ status: 'published' }).eq('id', context.contentId);
    }
    reconciled += 1;
  }
  return { reconciled, evidence };
}

// X's public_metrics use API-specific field names. Map them to the same metric vocabulary
// used by Facebook/Instagram/LinkedIn (impressions, likes, comments, shares, saved) so the
// dashboard's cross-platform aggregation, engagement totals, and KPI cards recognize them.
// retweet_count and quote_count both represent a repost/quote-style share and are summed
// into a single "shares" value instead of overwriting each other under one metric key.
function normalizeXMetrics(raw: Record<string, unknown>): Record<string, number> {
  const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0)) || 0;
  const normalized: Record<string, number> = {
    impressions: num(raw.impression_count),
    likes: num(raw.like_count),
    comments: num(raw.reply_count),
    shares: num(raw.retweet_count) + num(raw.quote_count),
    saved: num(raw.bookmark_count),
  };
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => Number.isFinite(value)));
}

async function syncX(job: Job): Promise<number> {
  if (!job.external_post_id) return 0;
  const context = await variantContext(job);
  const account = await getAccount(job.workspace_id, 'x');
  const token = await xToken(account.id);
  const response = await fetchWithRetry(`https://api.twitter.com/2/tweets/${encodeURIComponent(job.external_post_id)}?tweet.fields=public_metrics,created_at`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  if (!response.ok || !body.data) throw new Error(body?.detail ?? 'X insights request failed');
  const metrics = normalizeXMetrics(body.data.public_metrics ?? {});
  const timestamp = body.data.created_at ?? job.published_at ?? new Date().toISOString();
  const rows = Object.entries(metrics).map(([metric, value]) => makeRow(job, context.contentId, 'x', 'x_api', metric, value, timestamp)).filter((row): row is InsightRow => Boolean(row));
  if (!rows.length) throw new Error('X returned no post-level metrics for this post');
  return upsertRows(rows);
}

async function syncFacebook(job: Job): Promise<number> {
  if (!job.external_post_id) return 0;
  const context = await variantContext(job);
  const account = await getAccount(job.workspace_id, 'facebook');
  const token = await accessTokenFor(account, 'Facebook');
  const post = await graphGet(`${META_GRAPH_VERSION}/${encodeURIComponent(job.external_post_id)}`, token, {
    fields: 'created_time,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)',
  });
  const timestamp = String(post.created_time ?? job.published_at ?? new Date().toISOString());
  const rows: InsightRow[] = [];
  const shares = (post.shares as Record<string, unknown> | undefined)?.count;
  const reactions = ((post.reactions as Record<string, unknown> | undefined)?.summary as Record<string, unknown> | undefined)?.total_count;
  const comments = ((post.comments as Record<string, unknown> | undefined)?.summary as Record<string, unknown> | undefined)?.total_count;
  for (const [metric, value] of [['shares', shares], ['reactions', reactions], ['comments', comments]] as Array<[string, unknown]>) {
    const row = makeRow(job, context.contentId, 'facebook', 'facebook_graph_api', metric, value, timestamp);
    if (row) rows.push(row);
  }

  try {
    const clickInsights = await graphGet(`${META_GRAPH_VERSION}/${encodeURIComponent(job.external_post_id)}/insights`, token, { metric: 'post_clicks' });
    for (const item of (clickInsights.data as Array<Record<string, unknown>> | undefined) ?? []) {
      const values = item.values as Array<Record<string, unknown>> | undefined;
      const row = makeRow(job, context.contentId, 'facebook', 'facebook_graph_api', 'clicks', values?.[0]?.value, timestamp);
      if (row) rows.push(row);
    }
  } catch {
    // post_clicks is optional; keep the interaction metrics if the Page lacks it.
  }

  if (!rows.length) throw new Error('Facebook returned no post-level insights for this post');
  return upsertRows(rows);
}

async function syncInstagram(job: Job): Promise<number> {
  if (!job.external_post_id) return 0;
  const context = await variantContext(job);
  const account = await getAccount(job.workspace_id, 'instagram');
  const token = await accessTokenFor(account, 'Instagram');
  const metricNames = ['comments', 'likes', 'reach', 'saved', 'shares', 'total_interactions', 'views'];
  const rows: InsightRow[] = [];
  const metricErrors: string[] = [];

  for (const metric of metricNames) {
    try {
      const body = await graphGet(`${META_GRAPH_VERSION}/${encodeURIComponent(job.external_post_id)}/insights`, token, { metric });
      const item = (body.data as Array<Record<string, unknown>> | undefined)?.[0];
      const values = item?.values as Array<Record<string, unknown>> | undefined;
      const value = (item?.total_value as Record<string, unknown> | undefined)?.value ?? values?.[0]?.value;
      const timestamp = String(values?.[0]?.end_time ?? job.published_at ?? new Date().toISOString());
      const row = makeRow(job, context.contentId, 'instagram', 'instagram_graph_api', metric, value, timestamp);
      if (row) rows.push(row);
    } catch (error) {
      metricErrors.push(`${metric}: ${error instanceof Error ? error.message : 'unavailable'}`);
    }
  }

  if (!rows.length) throw new Error(`Instagram returned no available media insights${metricErrors.length ? ` (${metricErrors.slice(0, 2).join('; ')})` : ''}`);
  return upsertRows(rows);
}

async function syncLinkedIn(job: Job): Promise<number> {
  if (!job.external_post_id) return 0;
  const context = await variantContext(job);
  const account = await getAccount(job.workspace_id, 'linkedin');
  const token = await accessTokenFor(account, 'LinkedIn');
  const externalUrn = job.external_post_id.startsWith('urn:li:') ? job.external_post_id : `urn:li:share:${job.external_post_id}`;
  const entityType = externalUrn.startsWith('urn:li:ugcPost:') ? 'ugc' : 'share';
  // Map LinkedIn's queryType constants to the same plural metric vocabulary the other
  // platforms use (impressions, reach, shares, reactions, comments). Storing the raw
  // lowercased API name ("impression", "members_reached", ...) previously meant these
  // rows never matched METRIC_LABELS/ENGAGEMENT_METRICS in the dashboard and were
  // effectively invisible even though the sync itself succeeded.
  const metrics: Array<[string, string]> = [
    ['IMPRESSION', 'impressions'],
    ['MEMBERS_REACHED', 'reach'],
    ['RESHARE', 'shares'],
    ['REACTION', 'reactions'],
    ['COMMENT', 'comments'],
  ];
  const rows: InsightRow[] = [];

  for (const [queryType, metric] of metrics) {
    const url = new URL('https://api.linkedin.com/rest/memberCreatorPostAnalytics');
    url.searchParams.set('q', 'entity');
    url.searchParams.set('entity', `(${entityType}:${externalUrn})`);
    url.searchParams.set('queryType', queryType);
    url.searchParams.set('aggregation', 'TOTAL');
    const response = await fetchWithRetry(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Restli-Protocol-Version': LINKEDIN_RESTLI_PROTOCOL_VERSION,
        'Linkedin-Version': LINKEDIN_API_VERSION,
      },
    });
    const body = await readJsonResponse(response, `LinkedIn ${queryType} analytics request failed`);
    const item = (body.elements as Array<Record<string, unknown>> | undefined)?.[0];
    const row = makeRow(job, context.contentId, 'linkedin', 'linkedin_member_creator_post_analytics', metric, item?.count, job.published_at ?? new Date().toISOString());
    if (row) rows.push(row);
  }

  if (!rows.length) throw new Error('LinkedIn returned no post-level analytics for this post');
  return upsertRows(rows);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const authToken = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: user } = await supabase.auth.getUser(authToken);
  if (!user.user) return json(401, { error: 'Invalid authentication' });
  let body: { workspaceId?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }
  if (!body.workspaceId) return json(400, { error: 'workspaceId is required' });
  const { data: membership } = await supabase.from('workspace_members').select('role').eq('workspace_id', body.workspaceId).eq('user_id', user.user.id).maybeSingle();
  if (!membership) return json(403, { error: 'Workspace access denied' });

  let reconciled = { reconciled: 0, evidence: 0 };
  try {
    reconciled = await reconcilePublishedJobs(body.workspaceId);
  } catch (error) {
    return json(500, { error: `Publish evidence reconciliation failed: ${error instanceof Error ? error.message : 'unknown error'}` });
  }

  const { data: jobs, error: jobsError } = await supabase.from('publishing_jobs').select('id,workspace_id,variant_id,calendar_item_id,external_post_id,platform,published_at,status').eq('workspace_id', body.workspaceId).eq('status', 'succeeded').not('external_post_id', 'is', null).order('published_at', { ascending: false }).limit(100);
  if (jobsError) return json(500, { error: jobsError.message });

  let synced = 0;
  const errors: Array<{ jobId: string; platform: string | null; error: string }> = [];
  const unsupportedPlatforms = new Set<string>();
  for (const job of (jobs as Job[]) ?? []) {
    try {
      if (job.platform === 'x') synced += await syncX(job);
      else if (job.platform === 'facebook') synced += await syncFacebook(job);
      else if (job.platform === 'instagram') synced += await syncInstagram(job);
      else if (job.platform === 'linkedin') synced += await syncLinkedIn(job);
      else if (job.platform) unsupportedPlatforms.add(job.platform);
    } catch (error) {
      const message = errorMessage(error);
      if (job.platform === 'linkedin' && /403|not enough permissions|permission/i.test(message)) {
        unsupportedPlatforms.add('linkedin');
      } else {
        errors.push({ jobId: job.id, platform: job.platform, error: message });
      }
    }
  }
  return json(200, {
    ok: true,
    synced,
    attempted: jobs?.length ?? 0,
    reconciledJobs: reconciled.reconciled,
    publishSuccessEvidence: reconciled.evidence,
    errors,
    unsupportedPlatforms: Array.from(unsupportedPlatforms).sort(),
  });
});
