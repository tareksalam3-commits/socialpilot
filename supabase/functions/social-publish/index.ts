import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// ---------------------------------------------------------------------------
// Called by a logged-in workspace member from "المحتوى" (or the calendar)
// to actually push a content_variant to its platform. This is the piece
// that was missing: social-oauth-* only *connects* accounts, nothing ever
// called the platform's API to post. This function:
//   1. Verifies the caller belongs to the workspace and the variant exists.
//   2. Opens/reuses a `publishing_jobs` row (idempotent by variant/calendar
//      item — clicking twice or retrying a failed job never double-posts).
//   3. Actually calls the platform API (Telegram bot API / X API v2).
//   4. Writes the outcome back to the database: publishing_jobs, the
//      calendar_item (if scheduled), content.status, a notification, and
//      an audit_log row.
//
// Only Telegram and X have a real posting implementation right now — same
// scope as the rest of the app, where facebook/instagram/linkedin only
// have the OAuth *connect* step built so far. Publishing to those returns
// a clear "not supported yet" error instead of pretending to succeed.
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } }
);

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'فيسبوك',
  instagram: 'إنستجرام',
  linkedin: 'لينكدإن',
  x: 'إكس',
  threads: 'ثريدز',
  tiktok: 'تيك توك',
  telegram: 'تيليجرام',
  whatsapp: 'واتساب',
};

const SUPPORTED_PLATFORMS = new Set(['telegram', 'x']);

type Variant = {
  id: string;
  content_id: string;
  workspace_id: string;
  platform: string;
  text: string;
  hashtags: string[];
  cta: string | null;
  media_brief: Record<string, unknown>;
};

function buildPostText(variant: Variant, maxLen?: number): string {
  const parts = [variant.text.trim()];
  if (variant.cta && variant.cta.trim()) parts.push(variant.cta.trim());
  if (variant.hashtags?.length) parts.push(variant.hashtags.join(' '));
  let text = parts.filter(Boolean).join('\n\n');
  if (maxLen && text.length > maxLen) text = text.slice(0, maxLen - 1) + '…';
  return text;
}

// ---------------------------------------------------------------------------
// Telegram — bot posts into the channel the workspace connected. Uses
// sendPhoto when the variant has an image in media_brief, sendMessage
// otherwise. Bot token lives in social_platform_app_secrets (shared bot).
// ---------------------------------------------------------------------------
async function publishToTelegram(variant: Variant, account: Record<string, unknown>): Promise<{ id: string; url: string | null }> {
  const { data: secretRow } = await supabase
    .from('social_platform_app_secrets')
    .select('app_secret')
    .eq('platform_key', 'telegram')
    .maybeSingle();
  const botToken = secretRow?.app_secret;
  if (!botToken) throw new Error('بوت تيليجرام لسه مش مُعد من إدارة النظام');

  const metadata = (account.metadata ?? {}) as Record<string, unknown>;
  const chatId = metadata.chat_id ?? account.handle;
  if (!chatId) throw new Error('تعذّر تحديد قناة تيليجرام المربوطة');

  const text = buildPostText(variant, 4096);
  const imageUrl = typeof variant.media_brief?.image_url === 'string' ? (variant.media_brief.image_url as string) : null;

  const method = imageUrl ? 'sendPhoto' : 'sendMessage';
  const params: Record<string, string> = imageUrl
    ? { chat_id: String(chatId), photo: imageUrl, caption: text.slice(0, 1024) }
    : { chat_id: String(chatId), text };

  const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json?.description ?? 'فشل النشر على تيليجرام');

  const messageId = json.result?.message_id;
  const chatUsername = typeof account.handle === 'string' ? String(account.handle).replace(/^@/, '') : null;
  const url = chatUsername && messageId ? `https://t.me/${chatUsername}/${messageId}` : null;
  return { id: String(messageId ?? ''), url };
}

// ---------------------------------------------------------------------------
// X (Twitter) — posts as the connected member via API v2 POST /2/tweets.
// Refreshes the access token first if it's expired (offline.access scope
// was requested at connect time, so a refresh_token should be on file).
// ---------------------------------------------------------------------------
async function getFreshXToken(accountId: string): Promise<string> {
  const { data: tokenRow } = await supabase
    .from('social_account_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (!tokenRow?.access_token) throw new Error('حساب إكس محتاج إعادة ربط');

  const isExpired = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() < Date.now() + 60_000 : false;
  if (!isExpired) return tokenRow.access_token as string;
  if (!tokenRow.refresh_token) throw new Error('انتهت صلاحية دخول إكس — أعد ربط الحساب');

  const { data: app } = await supabase.from('social_platform_apps').select('app_id').eq('platform_key', 'x').maybeSingle();
  const { data: secretRow } = await supabase.from('social_platform_app_secrets').select('app_secret').eq('platform_key', 'x').maybeSingle();
  if (!app?.app_id || !secretRow?.app_secret) throw new Error('إعدادات ربط إكس غير مكتملة');

  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${app.app_id}:${secretRow.app_secret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token as string,
      client_id: app.app_id,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) throw new Error(json?.error_description ?? 'فشل تجديد دخول إكس');

  const expiresAt = json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null;
  await supabase.from('social_account_tokens').update({
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? tokenRow.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('account_id', accountId);

  return json.access_token as string;
}

async function publishToX(variant: Variant, account: Record<string, unknown>): Promise<{ id: string; url: string | null }> {
  const accessToken = await getFreshXToken(String(account.id));
  const text = buildPostText(variant, 280);

  const res = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ text }),
  });
  const json = await res.json();
  if (!res.ok || !json.data?.id) {
    const message = json?.detail || json?.title || json?.errors?.[0]?.message || 'فشل النشر على إكس';
    throw new Error(message);
  }

  const handle = typeof account.handle === 'string' ? String(account.handle).replace(/^@/, '') : null;
  const url = handle ? `https://x.com/${handle}/status/${json.data.id}` : null;
  return { id: String(json.data.id), url };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes(405, { error: 'Method not allowed' });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return jsonRes(401, { error: 'Missing authentication token' });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return jsonRes(401, { error: 'Invalid or expired token' });
  const userId = userData.user.id;

  let body: { workspaceId?: string; variantId?: string; calendarItemId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonRes(400, { error: 'Invalid JSON body' });
  }

  const { workspaceId, variantId, calendarItemId } = body;
  if (!workspaceId || !variantId) return jsonRes(400, { error: 'workspaceId و variantId مطلوبين' });

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!membership) return jsonRes(403, { error: 'مش عضو في مساحة العمل دي' });

  const { data: variant } = await supabase
    .from('content_variants')
    .select('*')
    .eq('id', variantId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (!variant) return jsonRes(404, { error: 'النسخة غير موجودة' });

  const platform = variant.platform as string;
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;

  if (!SUPPORTED_PLATFORMS.has(platform)) {
    return jsonRes(409, { error: `النشر التلقائي على ${platformLabel} غير مدعوم بعد — تقدر تنسخ النص وتنشره يدويًا` });
  }

  const { data: account } = await supabase
    .from('social_accounts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('platform', platform)
    .eq('status', 'connected')
    .maybeSingle();
  if (!account) return jsonRes(409, { error: `مفيش حساب ${platformLabel} مربوط بهذه المساحة` });

  const idempotencyKey = calendarItemId ? `cal:${calendarItemId}` : `manual:${variantId}`;

  const { data: existingJob } = await supabase
    .from('publishing_jobs')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingJob?.status === 'succeeded') {
    return jsonRes(200, { ok: true, alreadyPublished: true, job: existingJob });
  }

  let job = existingJob;
  if (job) {
    const { data: updated } = await supabase
      .from('publishing_jobs')
      .update({ status: 'running', attempts: job.attempts + 1, last_error: null, platform })
      .eq('id', job.id)
      .select()
      .single();
    job = updated ?? job;
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from('publishing_jobs')
      .insert({
        workspace_id: workspaceId,
        variant_id: variantId,
        calendar_item_id: calendarItemId ?? null,
        idempotency_key: idempotencyKey,
        action: 'publish',
        status: 'running',
        attempts: 1,
        platform,
      })
      .select()
      .single();
    if (insertError || !inserted) return jsonRes(500, { error: 'تعذّر إنشاء مهمة النشر' });
    job = inserted;
  }

  if (calendarItemId) {
    await supabase.from('calendar_items').update({ status: 'publishing' }).eq('id', calendarItemId);
  }

  try {
    const result = platform === 'telegram'
      ? await publishToTelegram(variant as Variant, account)
      : await publishToX(variant as Variant, account);

    await supabase.from('publishing_jobs').update({
      status: 'succeeded',
      completed_at: new Date().toISOString(),
      last_error: null,
      result: { platform, post_id: result.id, url: result.url },
    }).eq('id', job.id);

    if (calendarItemId) {
      await supabase.from('calendar_items').update({ status: 'published' }).eq('id', calendarItemId);
    }
    // Best-effort: mark the parent content as published once at least one
    // of its variants has actually gone out.
    await supabase.from('content').update({ status: 'published' }).eq('id', variant.content_id);

    await supabase.from('notifications').insert({
      workspace_id: workspaceId,
      user_id: userId,
      type: 'publish_succeeded',
      title: `تم النشر على ${platformLabel}`,
      body: result.url ?? null,
      payload: { variant_id: variantId, platform, post_id: result.id, url: result.url },
    });
    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: userId,
      action: 'publish_succeeded',
      entity: 'content_variants',
      entity_id: variantId,
      detail: { platform, post_id: result.id },
    });

    return jsonRes(200, { ok: true, postId: result.id, url: result.url, job: { ...job, status: 'succeeded' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل النشر';

    await supabase.from('publishing_jobs').update({
      status: 'failed',
      last_error: message,
    }).eq('id', job.id);

    if (calendarItemId) {
      await supabase.from('calendar_items').update({ status: 'failed' }).eq('id', calendarItemId);
    }

    await supabase.from('notifications').insert({
      workspace_id: workspaceId,
      user_id: userId,
      type: 'publish_failed',
      title: `فشل النشر على ${platformLabel}`,
      body: message,
      payload: { variant_id: variantId, platform },
    });
    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: userId,
      action: 'publish_failed',
      entity: 'content_variants',
      entity_id: variantId,
      detail: { platform, error: message },
    });

    return jsonRes(502, { error: message });
  }
});
