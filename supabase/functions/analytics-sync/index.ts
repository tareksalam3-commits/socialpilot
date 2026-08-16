import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};
const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } });
const META_GRAPH_VERSION = Deno.env.get('META_GRAPH_VERSION') ?? 'v26.0';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

type Job = {
  id: string;
  workspace_id: string;
  variant_id: string | null;
  external_post_id: string | null;
  platform: string | null;
  published_at: string | null;
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

async function readJsonResponse(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = body.error as Record<string, unknown> | undefined;
    throw new Error(String(error?.message ?? body.detail ?? body.title ?? fallback));
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

async function syncX(job: Job): Promise<number> {
  if (!job.external_post_id) return 0;
  const context = await variantContext(job);
  const account = await getAccount(job.workspace_id, 'x');
  const token = await xToken(account.id);
  const response = await fetchWithRetry(`https://api.twitter.com/2/tweets/${encodeURIComponent(job.external_post_id)}?tweet.fields=public_metrics,created_at`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await response.json();
  if (!response.ok || !body.data) throw new Error(body?.detail ?? 'X insights request failed');
  const metrics = body.data.public_metrics ?? {};
  const timestamp = body.data.created_at ?? job.published_at ?? new Date().toISOString();
  const rows = Object.entries(metrics).map(([metric, value]) => makeRow(job, context.contentId, 'x', 'x_api', metric, value, timestamp)).filter((row): row is InsightRow => Boolean(row));
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
  const { data: jobs, error: jobsError } = await supabase.from('publishing_jobs').select('id,workspace_id,variant_id,external_post_id,platform,published_at').eq('workspace_id', body.workspaceId).eq('status', 'succeeded').not('external_post_id', 'is', null).order('published_at', { ascending: false }).limit(100);
  if (jobsError) return json(500, { error: jobsError.message });

  let synced = 0;
  const errors: Array<{ jobId: string; platform: string | null; error: string }> = [];
  const unsupportedPlatforms = new Set<string>();
  for (const job of (jobs as Job[]) ?? []) {
    try {
      if (job.platform === 'x') synced += await syncX(job);
      else if (job.platform === 'facebook') synced += await syncFacebook(job);
      else if (job.platform === 'instagram') synced += await syncInstagram(job);
      else if (job.platform) unsupportedPlatforms.add(job.platform);
    } catch (error) {
      errors.push({ jobId: job.id, platform: job.platform, error: error instanceof Error ? error.message : 'sync failed' });
    }
  }
  return json(200, { ok: true, synced, attempted: jobs?.length ?? 0, errors, unsupportedPlatforms: Array.from(unsupportedPlatforms).sort() });
});
