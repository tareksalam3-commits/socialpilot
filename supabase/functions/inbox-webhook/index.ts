import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getCredential } from '../_shared/credentials.ts';
import { runInboxAutomation } from '../_shared/inboxAutomation.ts';

// Public endpoint — Meta calls this directly with no Supabase auth header,
// so this function must be deployed with --no-verify-jwt (same as
// meta-oauth-callback, which Meta also hits directly).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Hub-Signature-256',
};

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: corsHeaders });
}

function safeWebhookDate(value: unknown): string | null {
  if (typeof value === 'number') return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
}

async function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expectedHex = signatureHeader.slice('sha256='.length);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  // Timing-safe-ish comparison — lengths are fixed/known (64 hex chars) so a
  // simple loop is fine here without needing a dedicated constant-time lib.
  if (computedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) diff |= computedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

async function findAccounts(supabase: SupabaseClient, providerAccountId: string) {
  const { data, error } = await supabase
    .from('connected_accounts')
    .select('id, workspace_id, platform')
    .in('platform', ['facebook', 'instagram', 'whatsapp'])
    .eq('provider_account_id', providerAccountId)
    .eq('status', 'connected')
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

async function upsertConversationAndMessage(
  supabase: SupabaseClient,
  input: {
    account_id: string;
    workspace_id: string;
    platform: string;
    type: 'dm' | 'comment';
    external_id: string;
    external_participant_id: string | null;
    sender_name: string | null;
    content: string;
    message_external_id: string;
    post_external_id?: string | null;
    created_at?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  let postId: string | null = null;
  if (input.post_external_id) {
    const { data: target } = await supabase
      .from('post_platform_targets')
      .select('post_id')
      .eq('account_id', input.account_id)
      .eq('platform', input.platform)
      .eq('external_id', input.post_external_id)
      .maybeSingle();
    postId = (target?.post_id as string | undefined) ?? null;
  }

  const { data: conv, error: convError } = await supabase
    .from('inbox_conversations')
    .upsert(
      {
        workspace_id: input.workspace_id,
        account_id: input.account_id,
        platform: input.platform,
        external_id: input.external_id,
        type: input.type,
        post_id: postId,
        sender_name: input.sender_name,
        external_participant_id: input.external_participant_id,
        snippet: input.content,
        unread: true,
        updated_at: input.created_at ?? new Date().toISOString(),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      },
      { onConflict: 'account_id,platform,type,external_id' },
    )
    .select()
    .single();
  if (convError || !conv) {
    console.error('inbox-webhook: failed to upsert conversation', convError?.message);
    return null;
  }

  const { data: existingMessage } = await supabase
    .from('inbox_messages')
    .select('id')
    .eq('conversation_id', conv.id)
    .eq('external_id', input.message_external_id)
    .maybeSingle();
  if (existingMessage) return { conversation: conv, isNewMessage: false };

  const { data: insertedMessage, error: msgError } = await supabase.from('inbox_messages').upsert({
    conversation_id: conv.id,
    user_id: null,
    direction: 'inbound',
    content: input.content,
    is_ai: false,
    external_id: input.message_external_id,
    sender_external_id: input.external_participant_id,
    sender_name: input.sender_name,
    ...(input.created_at ? { created_at: input.created_at } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }, { onConflict: 'conversation_id,external_id', ignoreDuplicates: true }).select('id').maybeSingle();
  if (msgError) {
    console.error('inbox-webhook: failed to insert message', msgError.message);
    return null;
  }

  return { conversation: conv, isNewMessage: Boolean(insertedMessage) };
}

async function handleMetaEntry(supabase: SupabaseClient, entry: Record<string, unknown>) {
  const pageId = entry.id as string | undefined;
  if (!pageId) return;
  let accounts = await findAccounts(supabase, pageId);
  if (accounts.length === 0) {
    const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
    for (const change of changes) {
      const value = (change.value as Record<string, unknown> | undefined) ?? {};
      const metadata = value.metadata as Record<string, unknown> | undefined;
      const phoneNumberId = metadata?.phone_number_id as string | undefined;
      if (phoneNumberId) {
        accounts = await findAccounts(supabase, phoneNumberId);
        if (accounts.length > 0) break;
      }
    }
  }
  if (accounts.length === 0) return; // webhook for an account we don't have connected — ignore

  for (const account of accounts) {
    // Messenger / Instagram DMs
  const messaging = (entry.messaging as Array<Record<string, unknown>> | undefined) ?? [];
  for (const m of messaging) {
    const message = m.message as Record<string, unknown> | undefined;
    const text = message?.text as string | undefined;
    const senderId = (m.sender as Record<string, unknown> | undefined)?.id as string | undefined;
    if (!text || !senderId || message?.is_echo) continue; // skip echoes of our own sent messages
    const conv = await upsertConversationAndMessage(supabase, {
      account_id: account.id as string,
      workspace_id: account.workspace_id as string,
      platform: account.platform as string,
      type: 'dm',
      external_id: senderId,
      external_participant_id: senderId,
      sender_name: null,
      content: text,
      message_external_id: (message?.id as string | undefined) ?? `${senderId}:${m.timestamp ?? Date.now()}`,
      created_at: typeof m.timestamp === 'number' ? new Date(m.timestamp * 1000).toISOString() : null,
      metadata: { source: 'meta_webhook' },
    });
    if (conv?.isNewMessage) await runInboxAutomation(supabase, conv.conversation.id as string, text);
  }

  // WhatsApp Cloud API messages
  if (account.platform === 'whatsapp') {
    const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
    for (const c of changes) {
      const value = (c.value as Record<string, unknown> | undefined) ?? {};
      const messages = (value.messages as Array<Record<string, unknown>> | undefined) ?? [];
      const contacts = (value.contacts as Array<Record<string, unknown>> | undefined) ?? [];
      for (const message of messages) {
        const messageId = message.id as string | undefined;
        const from = message.from as string | undefined;
        const body = message.text as Record<string, unknown> | undefined;
        const content = (body?.body ?? message.caption) as string | undefined;
        if (!messageId || !from || !content) continue;
        const contact = contacts.find((candidate) => candidate.wa_id === from);
        const profile = contact?.profile as Record<string, unknown> | undefined;
        const conv = await upsertConversationAndMessage(supabase, {
          account_id: account.id as string,
          workspace_id: account.workspace_id as string,
          platform: account.platform as string,
          type: 'dm',
          external_id: from,
          external_participant_id: from,
          sender_name: (profile?.name as string | undefined) ?? from,
          content,
          message_external_id: messageId,
          created_at: safeWebhookDate(message.timestamp),
          metadata: { source: 'whatsapp_webhook', message_type: message.type },
        });
        if (conv?.isNewMessage) await runInboxAutomation(supabase, conv.conversation.id as string, content);
      }
    }
    continue;
  }

  // Page/Instagram comments
  const changes = (entry.changes as Array<Record<string, unknown>> | undefined) ?? [];
  for (const c of changes) {
    const value = (c.value as Record<string, unknown> | undefined) ?? {};
    const isComment = c.field === 'comments' || (c.field === 'feed' && value.item === 'comment' && value.verb === 'add');
    if (!isComment) continue;
    const text = (value.text ?? value.message) as string | undefined;
    const commentId = (value.comment_id ?? value.id) as string | undefined;
    const from = value.from as Record<string, unknown> | undefined;
    if (!text || !commentId) continue;
    const parentId = (value.parent_id ?? value.post_id ?? commentId) as string;
    const conv = await upsertConversationAndMessage(supabase, {
      account_id: account.id as string,
      workspace_id: account.workspace_id as string,
      platform: account.platform as string,
      type: 'comment',
      external_id: parentId,
      external_participant_id: (from?.id as string | undefined) ?? null,
      sender_name: (from?.name ?? from?.username) as string | undefined ?? null,
      content: text,
      message_external_id: commentId,
      post_external_id: (value.post_id ?? value.object_id) as string | null,
      created_at: safeWebhookDate(value.created_time),
      metadata: { source: 'meta_webhook', field: c.field },
    });
    if (conv?.isNewMessage) await runInboxAutomation(supabase, conv.conversation.id as string, text);
  }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // Meta's webhook verification handshake — GET with hub.mode/hub.verify_token/hub.challenge.
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    const expected = await getCredential(supabase, 'meta_webhook_verify_token');
    if (mode === 'subscribe' && token && expected && token === expected) {
      return textResponse(challenge ?? '', 200);
    }
    return textResponse('Forbidden', 403);
  }

  if (req.method !== 'POST') return textResponse('Method not allowed', 405);

  const rawBody = await req.text();

  const appSecret = await getCredential(supabase, 'meta_app_secret');
  if (appSecret) {
    const valid = await verifySignature(rawBody, req.headers.get('X-Hub-Signature-256'), appSecret);
    if (!valid) return textResponse('Invalid signature', 401);
  } else {
    // No app secret configured yet — refuse rather than silently trust
    // unverified payloads claiming to be Meta.
    console.error('inbox-webhook: meta_app_secret not configured, rejecting webhook');
    return textResponse('Not configured', 503);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return textResponse('Invalid JSON', 400);
  }

  const entries = (payload.entry as Array<Record<string, unknown>> | undefined) ?? [];
  for (const entry of entries) {
    try {
      await handleMetaEntry(supabase, entry);
    } catch (err) {
      console.error('inbox-webhook: failed to process entry', err instanceof Error ? err.message : err);
    }
  }

  // Meta requires a fast 200 regardless of per-entry outcomes, or it will
  // back off and eventually disable the subscription.
  return textResponse('EVENT_RECEIVED', 200);
});
