import { corsHeadersFor, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';
import { syncAccount } from '../_shared/accountHealth.ts';

type SyncBody = { account_id?: string; workspace_id?: string };

// Verifies each connected account (Facebook Page, Instagram Business,
// LinkedIn personal, LinkedIn Company Page) still has a valid token by
// calling the platform directly, and refreshes health_status/sync_status/
// handle accordingly. Pass account_id to sync one account, or workspace_id
// to sync every connected account in that workspace.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const supabase = serviceClient();
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  const { account_id, workspace_id }: SyncBody = await req.json().catch(() => ({}));
  if (!account_id && !workspace_id) return errorResponse('account_id or workspace_id is required', 400);

  const columns = 'id, workspace_id, platform, handle, provider_account_id, access_token_encrypted, token_expires_at, metadata';

  if (account_id) {
    const { data: account } = await supabase.from('connected_accounts').select(columns).eq('id', account_id).maybeSingle();
    if (!account) return errorResponse('Account not found', 404);

    const { data: membership } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', account.workspace_id as string)
      .eq('user_id', callerId)
      .maybeSingle();
    if (!membership) return errorResponse('Forbidden', 403);

    const outcome = await syncAccount(supabase, account as never);
    return jsonResponse({ synced: 1, results: [{ account_id, ...outcome }] });
  }

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', workspace_id as string)
    .eq('user_id', callerId)
    .maybeSingle();
  if (!membership) return errorResponse('Forbidden', 403);

  const { data: accounts } = await supabase
    .from('connected_accounts')
    .select(columns)
    .eq('workspace_id', workspace_id as string)
    .eq('status', 'connected');

  const results = [];
  for (const account of accounts ?? []) {
    const outcome = await syncAccount(supabase, account as never);
    results.push({ account_id: account.id, ...outcome });
  }

  return jsonResponse({ synced: results.length, results });
});
