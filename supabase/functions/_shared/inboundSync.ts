import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

const GRAPH = 'https://graph.facebook.com/v21.0';
const THREADS_GRAPH = 'https://graph.threads.net/v1.0';
const LINKEDIN_VERSION = '202606';

type Account = {
  id: string;
  workspace_id: string;
  platform: string;
  handle: string | null;
  provider_account_id: string | null;
  access_token_encrypted: string | null;
  metadata: Record<string, unknown> | null;
};

type Target = {
  id: string;
  post_id: string;
  external_id: string | null;
  platform: string;
};

type Stats = {
  platform: string;
  posts: number;
  analytics: number;
  conversations: number;
  messages: number;
  skipped: number;
  warnings: string[];
};

type NormalizedMessage = {
  externalId: string;
  externalConversationId: string;
  type: 'dm' | 'comment';
  content: string;
  participantId: string | null;
  senderName: string | null;
  postExternalId?: string | null;
  createdAt?: string | null;
  metadata?: Record<string, unknown>;
};

type Analytics = {
  externalId: string;
  reach?: number;
  impressions?: number;
  engagement?: number;
  clicks?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  views?: number;
  watchTimeSeconds?: number;
  completionRate?: number;
  profileVisits?: number;
  rawMetrics: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function safeDate(value: unknown): string | null {
  if (typeof value === 'number') return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = asRecord(asRecord(body).error);
    throw new Error(`${res.status}: ${text(error.message) ?? text(body) ?? res.statusText}`);
  }
  return asRecord(body);
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  return readJson(await fetch(url, { headers }));
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  return readJson(await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
}

async function listTargets(supabase: SupabaseClient, account: Account): Promise<Target[]> {
  const { data, error } = await supabase
    .from('post_platform_targets')
    .select('id,post_id,external_id,platform')
    .eq('account_id', account.id)
    .eq('platform', account.platform)
    .eq('status', 'published')
    .not('external_id', 'is', null)
    .order('published_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as Target[];
}

function idVariants(value: string): string[] {
  const trimmed = value.trim();
  return [trimmed, trimmed.split('_').pop() ?? trimmed, trimmed.split(':').pop() ?? trimmed];
}

function findTarget(targets: Target[], externalId: string | null): Target | undefined {
  if (!externalId) return undefined;
  const variants = new Set(idVariants(externalId));
  return targets.find((target) => idVariants(target.external_id ?? '').some((id) => variants.has(id)));
}

async function upsertAnalytics(supabase: SupabaseClient, account: Account, analytics: Analytics, targets: Target[]): Promise<boolean> {
  const target = findTarget(targets, analytics.externalId);
  if (!target) return false;
  const now = new Date().toISOString();
  const row = {
    post_id: target.post_id,
    workspace_id: account.workspace_id,
    platform: account.platform,
    reach: analytics.reach ?? 0,
    impressions: analytics.impressions ?? 0,
    engagement: analytics.engagement ?? ((analytics.likes ?? 0) + (analytics.comments ?? 0) + (analytics.shares ?? 0)),
    clicks: analytics.clicks ?? 0,
    likes: analytics.likes ?? 0,
    comments: analytics.comments ?? 0,
    shares: analytics.shares ?? 0,
    ...(analytics.saves !== undefined ? { saves: analytics.saves } : {}),
    ...(analytics.views !== undefined ? { views: analytics.views } : {}),
    ...(analytics.watchTimeSeconds !== undefined ? { watch_time_seconds: analytics.watchTimeSeconds } : {}),
    ...(analytics.completionRate !== undefined ? { completion_rate: analytics.completionRate } : {}),
    ...(analytics.profileVisits !== undefined ? { profile_visits: analytics.profileVisits } : {}),
    raw_metrics: analytics.rawMetrics,
    recorded_at: now,
  };
  const { error } = await supabase.from('post_analytics').upsert(row, { onConflict: 'post_id,platform,analytics_date' });
  if (error) throw error;
  return true;
}

async function upsertAccountAnalytics(supabase: SupabaseClient, account: Account, metrics: Record<string, unknown>): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const values = {
    workspace_id: account.workspace_id,
    account_id: account.id,
    platform: account.platform,
    followers: asNumber(metrics.followers) ?? asNumber(metrics.followers_count) ?? 0,
    followers_delta: asNumber(metrics.followers_delta) ?? 0,
    reach: asNumber(metrics.reach) ?? 0,
    impressions: asNumber(metrics.impressions) ?? 0,
    engagement: asNumber(metrics.engagement) ?? 0,
    clicks: asNumber(metrics.clicks) ?? 0,
    recorded_at: today,
  };
  const { error } = await supabase.from('account_analytics').upsert(values, { onConflict: 'account_id,platform,recorded_at' });
  if (error) throw error;
}

async function ingestMessage(supabase: SupabaseClient, account: Account, message: NormalizedMessage, targets: Target[]): Promise<{ conversation: boolean; message: boolean }> {
  const target = findTarget(targets, message.postExternalId ?? null);
  const conversationId = message.externalConversationId;
  const timestamp = message.createdAt ?? new Date().toISOString();
  const conversationFields = {
    workspace_id: account.workspace_id,
    account_id: account.id,
    platform: account.platform,
    external_id: conversationId,
    type: message.type,
    snippet: message.content,
    updated_at: timestamp,
    ...(target?.post_id ? { post_id: target.post_id } : {}),
    ...(message.participantId ? { external_participant_id: message.participantId } : {}),
    ...(message.senderName ? { sender_name: message.senderName } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
  };

  // Do not rewrite an existing conversation before checking its source message:
  // polling old pages must not rewind updated_at or turn a read conversation back
  // to unread. New messages alone advance the conversation and set unread=true.
  const { data: existingConversation, error: lookupError } = await supabase
    .from('inbox_conversations')
    .select('id')
    .eq('account_id', account.id)
    .eq('platform', account.platform)
    .eq('type', message.type)
    .eq('external_id', conversationId)
    .maybeSingle();
  if (lookupError) throw lookupError;

  let conversationIdLocal = existingConversation?.id as string | undefined;
  if (conversationIdLocal) {
    const { data: existingMessage, error: messageLookupError } = await supabase
      .from('inbox_messages')
      .select('id')
      .eq('conversation_id', conversationIdLocal)
      .eq('external_id', message.externalId)
      .maybeSingle();
    if (messageLookupError) throw messageLookupError;
    if (existingMessage?.id) return { conversation: true, message: false };

    const { error: conversationUpdateError } = await supabase
      .from('inbox_conversations')
      .update({ ...conversationFields, unread: true })
      .eq('id', conversationIdLocal);
    if (conversationUpdateError) throw conversationUpdateError;
  } else {
    const { data: conversation, error: conversationError } = await supabase
      .from('inbox_conversations')
      .upsert({ ...conversationFields, unread: true }, { onConflict: 'account_id,platform,type,external_id' })
      .select('id')
      .single();
    if (conversationError || !conversation) throw conversationError ?? new Error('Conversation upsert returned no row');
    conversationIdLocal = conversation.id;
  }

  const { error: messageError } = await supabase.from('inbox_messages').insert({
    conversation_id: conversationIdLocal,
    user_id: null,
    direction: 'inbound',
    content: message.content,
    is_ai: false,
    external_id: message.externalId,
    sender_external_id: message.participantId,
    sender_name: message.senderName,
    ...(message.createdAt ? { created_at: message.createdAt } : {}),
    ...(message.metadata ? { metadata: message.metadata } : {}),
  });
  if (messageError) {
    // A concurrent webhook/poll can race the existence check. The unique source
    // index makes the second writer harmless; other errors remain actionable.
    if (!String(messageError.message).toLowerCase().includes('duplicate')) throw messageError;
    return { conversation: true, message: false };
  }
  return { conversation: true, message: true };
}

function metaCommentMessages(value: Record<string, unknown>, postExternalId: string | null): NormalizedMessage[] {
  const comments = Array.isArray(value.comments) ? value.comments : [];
  return comments.flatMap((raw) => {
    const item = asRecord(raw);
    const from = asRecord(item.from);
    const id = text(item.id);
    const body = text(item.message) ?? text(item.text);
    if (!id || !body) return [];
    const parentExternalId = text(item.parent_id) ?? postExternalId ?? id;
    return [{ externalId: id, externalConversationId: parentExternalId, type: 'comment', content: body, participantId: text(from.id), senderName: text(from.name) ?? text(from.username), postExternalId, createdAt: safeDate(item.created_time), metadata: { source: 'meta_poll' } }];
  });
}

async function syncMeta(supabase: SupabaseClient, account: Account, targets: Target[], stats: Stats): Promise<void> {
  if (!account.access_token_encrypted || !account.provider_account_id) return;
  const token = account.access_token_encrypted;
  const accountId = account.provider_account_id;
  const isInstagram = account.platform === 'instagram';
  const fields = isInstagram
    ? 'id,caption,timestamp,like_count,comments_count,comments.limit(50){id,text,username,timestamp,from}'
    : 'id,message,created_time,comments.limit(50){id,message,from,created_time,parent_id}';
  const posts = await getJson(`${GRAPH}/${accountId}/${isInstagram ? 'media' : 'published_posts'}?fields=${encodeURIComponent(fields)}&limit=50&access_token=${encodeURIComponent(token)}`);
  const postRows = Array.isArray(posts.data) ? posts.data : [];
  stats.posts += postRows.length;
  for (const raw of postRows) {
    const post = asRecord(raw);
    const externalId = text(post.id);
    const comments = asRecord(post.comments);
    const analytics: Analytics = {
      externalId: externalId ?? '',
      likes: asNumber(post.like_count),
      comments: asNumber(post.comments_count) ?? (Array.isArray(comments.data) ? comments.data.length : undefined),
      rawMetrics: post,
    };
    if (externalId && await upsertAnalytics(supabase, account, analytics, targets)) stats.analytics++;
    for (const message of metaCommentMessages({ comments: Array.isArray(comments.data) ? comments.data : [] }, externalId)) {
      const result = await ingestMessage(supabase, account, message, targets);
      stats.conversations += result.conversation ? 1 : 0;
      stats.messages += result.message ? 1 : 0;
    }
  }

  // Messenger and Instagram DMs are available only when the connected token has
  // the corresponding permission. Permission errors are reported as warnings,
  // not converted into fake empty conversations.
  try {
    const conversations = await getJson(`${GRAPH}/${accountId}/conversations?fields=id,updated_time,participants,messages.limit(50){id,message,from,created_time}&limit=50&access_token=${encodeURIComponent(token)}`);
    for (const raw of Array.isArray(conversations.data) ? conversations.data : []) {
      const conv = asRecord(raw);
      const externalConversationId = text(conv.id);
      const messages = asRecord(conv.messages);
      if (!externalConversationId) continue;
      for (const messageRaw of Array.isArray(messages.data) ? messages.data : []) {
        const item = asRecord(messageRaw);
        const sender = asRecord(item.from);
        const id = text(item.id);
        const body = text(item.message);
        if (!id || !body) continue;
        const result = await ingestMessage(supabase, account, {
          externalId: id,
          externalConversationId,
          type: 'dm',
          content: body,
          participantId: text(sender.id),
          senderName: text(sender.name),
          createdAt: safeDate(item.created_time),
          metadata: { source: 'meta_poll' },
        }, targets);
        stats.conversations += result.conversation ? 1 : 0;
        stats.messages += result.message ? 1 : 0;
      }
    }
  } catch (error) {
    stats.warnings.push(`Meta conversations: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const metricNames = isInstagram
      ? 'impressions,reach,profile_views,follower_count'
      : 'page_impressions,page_engaged_users,page_fans,page_fan_adds,page_fan_removes';
    const insights = await getJson(`${GRAPH}/${accountId}/insights?metric=${encodeURIComponent(metricNames)}&period=day&access_token=${encodeURIComponent(token)}`);
    const accountMetrics: Record<string, unknown> = {};
    for (const raw of Array.isArray(insights.data) ? insights.data : []) {
      const item = asRecord(raw);
      const name = text(item.name);
      const values = Array.isArray(item.values) ? item.values : [];
      const value = asNumber(asRecord(values[0]).value);
      if (name && value !== undefined) accountMetrics[name] = value;
    }
    await upsertAccountAnalytics(supabase, account, {
      followers: accountMetrics.follower_count ?? accountMetrics.page_fans,
      followers_delta: isInstagram ? 0 : (asNumber(accountMetrics.page_fan_adds) ?? 0) - (asNumber(accountMetrics.page_fan_removes) ?? 0),
      reach: accountMetrics.reach,
      impressions: accountMetrics.impressions ?? accountMetrics.page_impressions,
      engagement: accountMetrics.page_engaged_users,
      raw_metrics: insights,
    });
  } catch (error) {
    stats.warnings.push(`Meta account analytics: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function syncLinkedIn(supabase: SupabaseClient, account: Account, targets: Target[], stats: Stats): Promise<void> {
  if (!account.access_token_encrypted) return;
  const headers = { Authorization: `Bearer ${account.access_token_encrypted}`, 'X-Restli-Protocol-Version': '2.0.0', 'Linkedin-Version': LINKEDIN_VERSION };
  let engagement = 0;
  let commentsTotal = 0;
  for (const target of targets.slice(0, 50)) {
    if (!target.external_id) continue;
    try {
      const encoded = encodeURIComponent(target.external_id);
      const comments = await getJson(`https://api.linkedin.com/rest/socialActions/${encoded}/comments?count=100`, headers);
      const elements = Array.isArray(comments.elements) ? comments.elements : [];
      for (const raw of elements) {
        const item = asRecord(raw);
        const id = text(item.commentUrn) ?? text(item.id);
        const body = text(asRecord(item.message).text);
        const actor = text(item.actor);
        if (!id || !body) continue;
        const result = await ingestMessage(supabase, account, { externalId: id, externalConversationId: target.external_id, type: 'comment', content: body, participantId: actor, senderName: actor, postExternalId: target.external_id, createdAt: safeDate(asRecord(item.created).time), metadata: { source: 'linkedin_poll' } }, targets);
        stats.conversations += result.conversation ? 1 : 0;
        stats.messages += result.message ? 1 : 0;
      }
      const social = await getJson(`https://api.linkedin.com/rest/socialActions/${encoded}`, headers);
      const summary = asRecord(social.likesSummary);
      const likes = asNumber(summary.totalLikes) ?? 0;
      const commentsCount = asNumber(asRecord(social.commentsSummary).totalFirstLevelComments) ?? elements.length;
      engagement += likes + commentsCount;
      commentsTotal += commentsCount;
      if (await upsertAnalytics(supabase, account, { externalId: target.external_id, likes, comments: commentsCount, engagement: likes + commentsCount, rawMetrics: social }, targets)) stats.analytics++;
    } catch (error) {
      stats.warnings.push(`LinkedIn ${target.external_id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await upsertAccountAnalytics(supabase, account, { engagement, comments: commentsTotal, raw_metrics: { source: 'linkedin_social_actions' } });
}

async function syncX(supabase: SupabaseClient, account: Account, targets: Target[], stats: Stats): Promise<void> {
  if (!account.access_token_encrypted || !account.provider_account_id) return;
  const url = `https://api.twitter.com/2/users/${encodeURIComponent(account.provider_account_id)}/tweets?tweet.fields=created_at,public_metrics,conversation_id&max_results=100`;
  const body = await getJson(url, { Authorization: `Bearer ${account.access_token_encrypted}` });
  let followers = 0;
  const reach = 0;
  let impressions = 0;
  let engagement = 0;
  for (const raw of Array.isArray(body.data) ? body.data : []) {
    const tweet = asRecord(raw);
    const metrics = asRecord(tweet.public_metrics);
    const id = text(tweet.id);
    if (!id) continue;
    const likes = asNumber(metrics.like_count) ?? 0;
    const replies = asNumber(metrics.reply_count) ?? 0;
    const reposts = asNumber(metrics.retweet_count) ?? 0;
    const tweetImpressions = asNumber(metrics.impression_count) ?? 0;
    engagement += likes + replies + reposts;
    impressions += tweetImpressions;
    if (await upsertAnalytics(supabase, account, { externalId: id, likes, comments: replies, shares: reposts, engagement: likes + replies + reposts, impressions: tweetImpressions, rawMetrics: tweet }, targets)) stats.analytics++;
  }
  try {
    const profile = await getJson('https://api.twitter.com/2/users/me?user.fields=public_metrics', { Authorization: `Bearer ${account.access_token_encrypted}` });
    const publicMetrics = asRecord(asRecord(profile.data).public_metrics);
    followers = asNumber(publicMetrics.followers_count) ?? 0;
  } catch (error) {
    stats.warnings.push(`X account analytics: ${error instanceof Error ? error.message : String(error)}`);
  }
  await upsertAccountAnalytics(supabase, account, { followers, reach, impressions, engagement, raw_metrics: body });
}

async function syncThreads(supabase: SupabaseClient, account: Account, targets: Target[], stats: Stats): Promise<void> {
  if (!account.access_token_encrypted || !account.provider_account_id) return;
  const token = account.access_token_encrypted;
  const media = await getJson(`${THREADS_GRAPH}/${account.provider_account_id}/threads?fields=id,text,timestamp,like_count,reply_count,repost_count,quote_count&limit=50&access_token=${encodeURIComponent(token)}`);
  for (const raw of Array.isArray(media.data) ? media.data : []) {
    const item = asRecord(raw);
    const id = text(item.id);
    if (!id) continue;
    const insights = await getJson(`${THREADS_GRAPH}/${id}/insights?metric=views,likes,replies,reposts,quotes,shares&access_token=${encodeURIComponent(token)}`).catch(() => ({}));
    const values: Record<string, number> = {};
    const insightsData: unknown[] = Array.isArray((insights as Record<string, unknown>).data) ? (insights as Record<string, unknown>).data as unknown[] : [];
    for (const metricRaw of insightsData) {
      const metric = asRecord(metricRaw);
      const name = text(metric.name);
      const value = asNumber(asRecord(Array.isArray(metric.values) ? metric.values[0] : null).value) ?? asNumber(asRecord(metric.total_value).value);
      if (name && value !== undefined) values[name] = value;
    }
    if (await upsertAnalytics(supabase, account, { externalId: id, views: values.views, likes: values.likes ?? asNumber(item.like_count), comments: values.replies ?? asNumber(item.reply_count), shares: values.shares, engagement: (values.likes ?? 0) + (values.replies ?? 0) + (values.reposts ?? 0), rawMetrics: { media: item, insights } }, targets)) stats.analytics++;
    try {
      const replies = await getJson(`${THREADS_GRAPH}/${id}/replies?fields=id,text,username,timestamp&limit=50&access_token=${encodeURIComponent(token)}`);
      for (const replyRaw of Array.isArray(replies.data) ? replies.data : []) {
        const reply = asRecord(replyRaw);
        const replyId = text(reply.id);
        const content = text(reply.text);
        if (!replyId || !content) continue;
        const result = await ingestMessage(supabase, account, { externalId: replyId, externalConversationId: id, type: 'comment', content, participantId: text(reply.username), senderName: text(reply.username), postExternalId: id, createdAt: safeDate(reply.timestamp), metadata: { source: 'threads_poll' } }, targets);
        stats.conversations += result.conversation ? 1 : 0;
        stats.messages += result.message ? 1 : 0;
      }
    } catch (error) {
      stats.warnings.push(`Threads replies ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function syncTikTok(supabase: SupabaseClient, account: Account, targets: Target[], stats: Stats): Promise<void> {
  if (!account.access_token_encrypted) return;
  const fields = ['id', 'create_time', 'like_count', 'comment_count', 'share_count', 'view_count', 'description'].join(',');
  const body = await postJson(`https://open.tiktokapis.com/v2/video/list/?fields=${encodeURIComponent(fields)}`, { max_count: 20 }, { Authorization: `Bearer ${account.access_token_encrypted}` });
  for (const raw of Array.isArray(asRecord(body.data).videos) ? asRecord(body.data).videos as unknown[] : []) {
    const video = asRecord(raw);
    const id = text(video.id);
    if (!id) continue;
    if (await upsertAnalytics(supabase, account, { externalId: id, likes: asNumber(video.like_count), comments: asNumber(video.comment_count), shares: asNumber(video.share_count), views: asNumber(video.view_count), engagement: (asNumber(video.like_count) ?? 0) + (asNumber(video.comment_count) ?? 0) + (asNumber(video.share_count) ?? 0), rawMetrics: video }, targets)) stats.analytics++;
  }
  stats.warnings.push('TikTok comments/messages require provider-approved scopes; no synthetic records were created.');
}

async function syncTelegram(supabase: SupabaseClient, account: Account, targets: Target[], stats: Stats): Promise<void> {
  if (!account.access_token_encrypted || !account.provider_account_id) return;
  const base = `https://api.telegram.org/bot${account.access_token_encrypted}`;
  const webhook = await getJson(`${base}/getWebhookInfo`);
  const webhookUrl = text(asRecord(webhook.result).url);
  if (webhookUrl) {
    stats.warnings.push('Telegram webhook is configured; polling was skipped to avoid getUpdates conflicts.');
    return;
  }
  const metadata = account.metadata ?? {};
  const offset = asNumber(metadata.telegram_update_offset);
  const url = `${base}/getUpdates?limit=100&allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}${offset ? `&offset=${offset}` : ''}`;
  const updates = await getJson(url);
  let nextOffset = offset ?? 0;
  for (const raw of Array.isArray(updates.result) ? updates.result : []) {
    const update = asRecord(raw);
    nextOffset = Math.max(nextOffset, (asNumber(update.update_id) ?? 0) + 1);
    const message = asRecord(update.message);
    const chat = asRecord(message.chat);
    const chatId = text(chat.id);
    const id = text(message.message_id);
    const content = text(message.text) ?? text(message.caption);
    if (!chatId || !id || !content || chatId !== account.provider_account_id) continue;
    const sender = asRecord(message.from);
    const result = await ingestMessage(supabase, account, { externalId: `${chatId}:${id}`, externalConversationId: chatId, type: 'dm', content, participantId: text(sender.id), senderName: text(sender.username) ?? text(sender.first_name), createdAt: safeDate(message.date), metadata: { source: 'telegram_poll', update_id: update.update_id } }, targets);
    stats.conversations += result.conversation ? 1 : 0;
    stats.messages += result.message ? 1 : 0;
  }
  if (nextOffset > (offset ?? 0)) await supabase.from('connected_accounts').update({ metadata: { ...metadata, telegram_update_offset: nextOffset } }).eq('id', account.id);
}

export async function syncInboundAccount(supabase: SupabaseClient, account: Account): Promise<Stats> {
  const stats: Stats = { platform: account.platform, posts: 0, analytics: 0, conversations: 0, messages: 0, skipped: 0, warnings: [] };
  if (!account.access_token_encrypted) {
    stats.warnings.push('No access token stored; inbound sync skipped.');
    return stats;
  }
  const targets = await listTargets(supabase, account);
  try {
    if (account.platform === 'facebook' || account.platform === 'instagram') await syncMeta(supabase, account, targets, stats);
    else if (account.platform === 'linkedin' || account.platform === 'linkedin_page') await syncLinkedIn(supabase, account, targets, stats);
    else if (account.platform === 'x') await syncX(supabase, account, targets, stats);
    else if (account.platform === 'threads') await syncThreads(supabase, account, targets, stats);
    else if (account.platform === 'tiktok') await syncTikTok(supabase, account, targets, stats);
    else if (account.platform === 'telegram') await syncTelegram(supabase, account, targets, stats);
    else if (account.platform === 'whatsapp') stats.warnings.push('WhatsApp inbound data is webhook-driven; use inbox-webhook with the WhatsApp subscription enabled.');
    else stats.warnings.push(`Unsupported platform: ${account.platform}`);
  } catch (error) {
    stats.warnings.push(`${account.platform} sync: ${error instanceof Error ? error.message : String(error)}`);
  }
  return stats;
}
