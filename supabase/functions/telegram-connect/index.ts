import { corsHeadersFor, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';

type ConnectBody = { workspace_id?: string; bot_token?: string; chat_id?: string };

// Telegram has no OAuth dialog for bots — a bot token is created once in
// BotFather and pasted in here. "Official Authentication" for this platform
// means verifying that token live against the Bot API (getMe) rather than
// trusting whatever the user typed, and confirming the bot can actually see
// the target chat/channel (getChat) before we call the account "connected".
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const supabase = serviceClient();
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  const { workspace_id, bot_token, chat_id }: ConnectBody = await req.json().catch(() => ({}));
  if (!workspace_id || !bot_token?.trim() || !chat_id?.trim()) {
    return errorResponse('workspace_id, bot_token, and chat_id are required', 400);
  }

  const { data: membership } = await supabase.from('workspace_members').select('id').eq('workspace_id', workspace_id).eq('user_id', callerId).maybeSingle();
  if (!membership) return errorResponse('Forbidden', 403);

  const token = bot_token.trim();
  const chatId = chat_id.trim();
  const base = `https://api.telegram.org/bot${token}`;

  try {
    const meRes = await fetch(`${base}/getMe`);
    const me = await meRes.json();
    if (!me.ok) throw new Error(me.description ?? 'Invalid bot token');

    const chatRes = await fetch(`${base}/getChat?chat_id=${encodeURIComponent(chatId)}`);
    const chat = await chatRes.json();
    if (!chat.ok) {
      throw new Error(chat.description ?? 'Bot cannot access this chat — make sure it has been added as an admin');
    }

    const handle = chat.result.username ? `@${chat.result.username}` : (chat.result.title ?? chatId);

    const { data, error } = await supabase
      .from('connected_accounts')
      .upsert(
        {
          workspace_id,
          platform: 'telegram',
          handle,
          provider_account_id: String(chat.result.id),
          access_token_encrypted: token,
          token_expires_at: null, // Bot tokens don't expire.
          status: 'connected',
          sync_status: 'synced',
          health_status: 'healthy',
          last_synced_at: new Date().toISOString(),
          metadata: { connected_by: callerId, bot_username: me.result.username, chat_type: chat.result.type },
        },
        { onConflict: 'workspace_id,platform,provider_account_id', ignoreDuplicates: false },
      )
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    return jsonResponse({ connected: true, account_id: data.id });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Could not connect this Telegram bot/chat', 400);
  }
});
