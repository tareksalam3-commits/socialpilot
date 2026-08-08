import { corsHeaders, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';
import { refreshTikTokTokens } from '../_shared/tiktokRefresh.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const supabase = serviceClient();
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  const { account_id } = await req.json().catch(() => ({}));
  if (!account_id) return errorResponse('account_id is required', 400);

  const { data: account } = await supabase.from('connected_accounts').select('id, workspace_id, platform').eq('id', account_id).maybeSingle();
  if (!account) return errorResponse('Account not found', 404);
  if (account.platform !== 'tiktok') return errorResponse('Token refresh is only supported for TikTok accounts on this endpoint', 400);

  const { data: membership } = await supabase.from('workspace_members').select('id').eq('workspace_id', account.workspace_id).eq('user_id', callerId).maybeSingle();
  if (!membership) return errorResponse('Forbidden', 403);

  const result = await refreshTikTokTokens(supabase, { accountId: account.id as string });
  if (result.refreshed === 0) {
    return errorResponse(result.details[0]?.error ?? 'Could not refresh this account\'s token', 502);
  }
  return jsonResponse({ refreshed: true });
});
