import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

const GRAPH = 'https://graph.facebook.com/v21.0';

type ConversationRow = {
  id: string;
  workspace_id: string;
  account_id: string | null;
  platform: string;
  type: 'comment' | 'dm';
  external_id: string | null;
  external_participant_id: string | null;
};

/** Actually delivers a reply to the platform. Throws with a clear message
 * on failure — callers decide how to surface/log that. */
async function deliverToPlatform(conv: ConversationRow, accessToken: string, providerAccountId: string | null, content: string): Promise<string | null> {
  if (conv.platform === 'facebook' || conv.platform === 'instagram') {
    if (conv.type === 'dm') {
      if (!conv.external_participant_id) throw new Error('Missing recipient id for this conversation — cannot send a DM reply');
      const res = await fetch(`${GRAPH}/me/messages?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: conv.external_participant_id },
          messaging_type: 'RESPONSE',
          message: { text: content },
        }),
      });
      if (!res.ok) throw new Error(`Meta Send API: ${res.status} ${await res.text()}`);
      return (await res.json().catch(() => ({}))).message_id ?? null;
    }
    // Comment reply. Instagram and Facebook use slightly different reply
    // endpoints under the same Graph API version.
    if (!conv.external_id) throw new Error('Missing comment id for this conversation — cannot reply to the comment');
    const endpoint = conv.platform === 'instagram' ? `${GRAPH}/${conv.external_id}/replies` : `${GRAPH}/${conv.external_id}/comments`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, access_token: accessToken }),
    });
    if (!res.ok) throw new Error(`Meta Comments API: ${res.status} ${await res.text()}`);
    return (await res.json().catch(() => ({}))).id ?? null;
  }

  if (conv.platform === 'linkedin') {
    if (conv.type === 'dm') {
      // LinkedIn's Messaging API is gated to approved Marketing/Talent
      // partners — a regular app credential (the same one used for posting)
      // cannot send DMs. Surface that plainly instead of pretending it
      // worked.
      throw new Error('LinkedIn does not expose DM sending to standard app credentials — reply manually on LinkedIn.');
    }
    if (!conv.external_id) throw new Error('Missing comment URN for this conversation — cannot reply to the comment');
    const res = await fetch(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(conv.external_id)}/comments`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
      body: JSON.stringify({ message: { text: content } }),
    });
    if (!res.ok) throw new Error(`LinkedIn comments: ${res.status} ${await res.text()}`);
    return res.headers.get('x-restli-id');
  }

  if (conv.platform === 'whatsapp') {
    if (!providerAccountId || !conv.external_participant_id) throw new Error('Missing WhatsApp phone number or recipient for this conversation');
    const res = await fetch(`${GRAPH}/${providerAccountId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: conv.external_participant_id, type: 'text', text: { body: content } }),
    });
    if (!res.ok) throw new Error(`WhatsApp Send API: ${res.status} ${await res.text()}`);
    return (await res.json().catch(() => ({}))).messages?.[0]?.id ?? null;
  }

  if (conv.platform === 'telegram') {
    if (!providerAccountId || !conv.external_participant_id) throw new Error('Missing Telegram chat for this conversation');
    const res = await fetch(`https://api.telegram.org/bot${accessToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: conv.external_participant_id, text: content }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(`Telegram Send API: ${res.status} ${body.description ?? ''}`);
    return body.result?.message_id ? `${conv.external_participant_id}:${body.result.message_id}` : null;
  }

  throw new Error(`Sending replies isn't supported yet for platform "${conv.platform}"`);
}

/** Sends a reply on a conversation: looks up the connected account's
 * decrypted token via `get_account_tokens` (the same RPC publish-post and
 * run-scheduler already use), actually calls the platform API, and only
 * then records the outbound message. Used by both the authenticated
 * `inbox-reply` edge function (manual replies) and the automation engine
 * (auto-send), the same way `orchestrator.ts#publishPost` is shared between
 * `publish-post` and `run-scheduler`. Returns the inserted message row. */
export async function sendInboxReply(
  supabase: SupabaseClient,
  input: { conversation_id: string; content: string; is_ai: boolean; user_id: string | null },
): Promise<Record<string, unknown>> {
  const { data: conv, error: convError } = await supabase
    .from('inbox_conversations')
    .select('id, workspace_id, account_id, platform, type, external_id, external_participant_id')
    .eq('id', input.conversation_id)
    .single();
  if (convError || !conv) throw new Error('Conversation not found');

  if (!conv.account_id) throw new Error('This conversation has no connected account — cannot send a reply');

  // This function is called with the service-role client after inbox-reply
  // already verified workspace membership. The old RPC passed p_caller_id=null,
  // which is intentionally rejected by get_account_tokens and made every reply
  // fail. Read the token only inside this server-side helper instead.
  const { data: account, error: accountError } = await supabase
    .from('connected_accounts')
    .select('provider_account_id, access_token_encrypted, status')
    .eq('id', conv.account_id)
    .eq('status', 'connected')
    .maybeSingle();
  if (accountError || !account?.access_token_encrypted) throw new Error('No access token for this account — reconnect it in Settings');

  const externalMessageId = await deliverToPlatform(conv as ConversationRow, account.access_token_encrypted as string, account.provider_account_id as string | null, input.content);

  const { data: message, error: insertError } = await supabase
    .from('inbox_messages')
    .insert({
      conversation_id: input.conversation_id,
      user_id: input.user_id,
      direction: 'outbound',
      content: input.content,
      is_ai: input.is_ai,
      ...(externalMessageId ? { external_id: externalMessageId } : {}),
      metadata: { source: 'inbox_reply', platform_message_id: externalMessageId },
    })
    .select()
    .single();
  if (insertError) throw insertError;

  await supabase
    .from('inbox_conversations')
    .update({ snippet: input.content, unread: false, updated_at: new Date().toISOString() })
    .eq('id', input.conversation_id);

  return message;
}
