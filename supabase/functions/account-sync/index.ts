import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const GRAPH_VERSION = Deno.env.get('META_GRAPH_VERSION') ?? 'v26.0';
const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type AccountRow = {
  id: string;
  workspace_id: string;
  platform: string;
  external_id: string | null;
  page_id: string | null;
  ig_user_id: string | null;
  handle: string | null;
  display_name: string | null;
  status: string;
  needs_reconnect: boolean;
  metadata: Record<string, unknown> | null;
};

type SyncOutcome = {
  ok: boolean;
  status: 'connected' | 'error' | 'expired';
  handle?: string;
  display_name?: string;
  error?: string;
};

type TokenRow = {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function tokenExpired(token: TokenRow | null): boolean {
  return Boolean(token?.expires_at && new Date(token.expires_at).getTime() <= Date.now() + 60_000);
}

async function readToken(accountId: string): Promise<TokenRow | null> {
  const { data } = await supabase
    .from('social_account_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('account_id', accountId)
    .maybeSingle();
  return (data as TokenRow | null) ?? null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json().catch(() => ({})) as Record<string, unknown>;
}

async function checkMeta(account: AccountRow, accessToken: string): Promise<SyncOutcome> {
  const providerId = account.platform === 'instagram'
    ? account.ig_user_id ?? account.external_id
    : account.page_id ?? account.external_id;
  if (!providerId) return { ok: false, status: 'error', error: 'معرّف الحساب الخارجي غير موجود' };

  const fields = account.platform === 'instagram' ? 'id,username,name' : 'id,name,username';
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${providerId}`);
  url.searchParams.set('fields', fields);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url);
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof (body.error as Record<string, unknown> | undefined)?.message === 'string'
      ? String((body.error as Record<string, unknown>).message)
      : `${response.status} ${response.statusText}`;
    const expired = Number((body.error as Record<string, unknown> | undefined)?.code) === 190 || response.status === 401;
    return { ok: false, status: expired ? 'expired' : 'error', error: message };
  }

  return {
    ok: true,
    status: 'connected',
    handle: typeof body.username === 'string' ? `@${body.username}` : undefined,
    display_name: typeof body.name === 'string' ? body.name : undefined,
  };
}

async function checkX(accessToken: string): Promise<SyncOutcome> {
  const response = await fetch('https://api.twitter.com/2/users/me?user.fields=name,username', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof body.detail === 'string' ? body.detail : `${response.status} ${response.statusText}`;
    return { ok: false, status: response.status === 401 ? 'expired' : 'error', error: message };
  }
  const data = (body.data ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    status: 'connected',
    handle: typeof data.username === 'string' ? `@${data.username}` : undefined,
    display_name: typeof data.name === 'string' ? data.name : undefined,
  };
}

async function checkLinkedIn(accessToken: string): Promise<SyncOutcome> {
  const response = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof body.message === 'string' ? body.message : `${response.status} ${response.statusText}`;
    return { ok: false, status: response.status === 401 ? 'expired' : 'error', error: message };
  }
  const name = [body.given_name, body.family_name].filter((value) => typeof value === 'string' && value).join(' ');
  return {
    ok: true,
    status: 'connected',
    handle: typeof body.email === 'string' ? body.email : undefined,
    display_name: name || undefined,
  };
}

async function checkThreads(account: AccountRow, accessToken: string): Promise<SyncOutcome> {
  const providerId = account.ig_user_id ?? account.external_id;
  if (!providerId) return { ok: false, status: 'error', error: 'معرّف Threads غير موجود' };
  const url = new URL(`https://graph.threads.net/v1.0/${providerId}`);
  url.searchParams.set('fields', 'id,username,name');
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url);
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof (body.error as Record<string, unknown> | undefined)?.message === 'string'
      ? String((body.error as Record<string, unknown>).message)
      : `${response.status} ${response.statusText}`;
    return { ok: false, status: response.status === 401 ? 'expired' : 'error', error: message };
  }
  return {
    ok: true,
    status: 'connected',
    handle: typeof body.username === 'string' ? `@${body.username}` : undefined,
    display_name: typeof body.name === 'string' ? body.name : undefined,
  };
}

async function checkTikTok(accessToken: string): Promise<SyncOutcome> {
  const response = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=display_name,username', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await readJson(response);
  const apiError = (body.error ?? {}) as Record<string, unknown>;
  if (!response.ok || (apiError.code && apiError.code !== 'ok')) {
    const message = typeof apiError.message === 'string' ? apiError.message : `${response.status} ${response.statusText}`;
    return { ok: false, status: response.status === 401 ? 'expired' : 'error', error: message };
  }
  const user = (body.data as Record<string, unknown> | undefined)?.user as Record<string, unknown> | undefined;
  return {
    ok: true,
    status: 'connected',
    handle: typeof user?.username === 'string' ? `@${user.username}` : undefined,
    display_name: typeof user?.display_name === 'string' ? user.display_name : undefined,
  };
}

async function checkTelegram(accessToken: string): Promise<SyncOutcome> {
  const response = await fetch(`https://api.telegram.org/bot${accessToken}/getMe`);
  const body = await readJson(response);
  if (!response.ok || body.ok !== true) {
    return { ok: false, status: response.status === 401 ? 'expired' : 'error', error: typeof body.description === 'string' ? body.description : 'Telegram bot token غير صالح' };
  }
  const user = (body.result ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    status: 'connected',
    handle: typeof user.username === 'string' ? `@${user.username}` : undefined,
    display_name: typeof user.first_name === 'string' ? user.first_name : undefined,
  };
}

async function checkWhatsApp(account: AccountRow, accessToken: string): Promise<SyncOutcome> {
  const providerId = account.external_id ?? account.page_id;
  if (!providerId) return { ok: false, status: 'error', error: 'معرّف WhatsApp غير موجود' };
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${providerId}`);
  url.searchParams.set('fields', 'verified_name,display_phone_number,quality_rating');
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url);
  const body = await readJson(response);
  if (!response.ok) {
    const message = typeof (body.error as Record<string, unknown> | undefined)?.message === 'string'
      ? String((body.error as Record<string, unknown>).message)
      : `${response.status} ${response.statusText}`;
    return { ok: false, status: response.status === 401 ? 'expired' : 'error', error: message };
  }
  return {
    ok: true,
    status: 'connected',
    display_name: typeof body.verified_name === 'string' ? body.verified_name : (typeof body.display_phone_number === 'string' ? body.display_phone_number : undefined),
  };
}

async function checkAccount(account: AccountRow): Promise<SyncOutcome> {
  const token = await readToken(account.id);
  if (!token?.access_token) return { ok: false, status: 'error', error: 'رمز الوصول غير موجود' };
  if (tokenExpired(token)) return { ok: false, status: 'expired', error: 'انتهت صلاحية رمز الوصول؛ أعد ربط الحساب' };

  switch (account.platform) {
    case 'facebook':
    case 'instagram':
      return checkMeta(account, token.access_token);
    case 'x':
      return checkX(token.access_token);
    case 'linkedin':
      return checkLinkedIn(token.access_token);
    case 'threads':
      return checkThreads(account, token.access_token);
    case 'tiktok':
      return checkTikTok(token.access_token);
    case 'telegram':
      return checkTelegram(token.access_token);
    case 'whatsapp':
      return checkWhatsApp(account, token.access_token);
    default:
      return { ok: false, status: 'error', error: `المنصة غير مدعومة: ${account.platform}` };
  }
}

async function syncOne(account: AccountRow): Promise<SyncOutcome> {
  const startedAt = new Date().toISOString();
  await supabase.from('social_accounts').update({ last_sync_at: startedAt }).eq('id', account.id);

  let outcome: SyncOutcome;
  try {
    outcome = await checkAccount(account);
  } catch (error) {
    outcome = { ok: false, status: 'error', error: error instanceof Error ? error.message : 'فشل فحص الحساب' };
  }

  const metadata = { ...(account.metadata ?? {}) };
  if (outcome.ok) {
    delete metadata.last_sync_error;
    delete metadata.last_sync_error_at;
  } else {
    metadata.last_sync_error = outcome.error ?? 'فشل فحص الحساب';
    metadata.last_sync_error_at = new Date().toISOString();
  }

  await supabase.from('social_accounts').update({
    status: outcome.status,
    needs_reconnect: outcome.status === 'expired',
    ...(outcome.handle ? { handle: outcome.handle } : {}),
    ...(outcome.display_name ? { display_name: outcome.display_name } : {}),
    metadata,
    last_sync_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', account.id);

  return { ...outcome, account_id: account.id, platform: account.platform } as SyncOutcome & { account_id: string; platform: string };
}

async function callerId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

async function hasWorkspaceAccess(workspaceId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const userId = await callerId(req);
  if (!userId) return json(401, { error: 'Unauthorized' });

  const body = await req.json().catch(() => ({})) as { account_id?: string; workspace_id?: string };
  if (!body.account_id && !body.workspace_id) return json(400, { error: 'account_id or workspace_id is required' });

  let accounts: AccountRow[] = [];
  if (body.account_id) {
    const { data: account, error } = await supabase
      .from('social_accounts')
      .select('id,workspace_id,platform,external_id,page_id,ig_user_id,handle,display_name,status,needs_reconnect,metadata')
      .eq('id', body.account_id)
      .maybeSingle();
    if (error) return json(500, { error: error.message });
    if (!account) return json(404, { error: 'Account not found' });
    if (!await hasWorkspaceAccess(account.workspace_id, userId)) return json(403, { error: 'Workspace access denied' });
    accounts = [account as AccountRow];
  } else {
    if (!await hasWorkspaceAccess(body.workspace_id!, userId)) return json(403, { error: 'Workspace access denied' });
    const { data, error } = await supabase
      .from('social_accounts')
      .select('id,workspace_id,platform,external_id,page_id,ig_user_id,handle,display_name,status,needs_reconnect,metadata')
      .eq('workspace_id', body.workspace_id!)
      .in('status', ['connected', 'expired', 'error']);
    if (error) return json(500, { error: error.message });
    accounts = (data ?? []) as AccountRow[];
  }

  const results = [];
  for (const account of accounts) results.push(await syncOne(account));
  return json(200, { synced: results.length, results });
});
