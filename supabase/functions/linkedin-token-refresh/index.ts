import { corsHeaders, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';
import { refreshLinkedInTokens } from '../_shared/linkedinRefresh.ts';

// Manual refresh: called from the "Refresh Token" button on the Connected
// Accounts page for a single LinkedIn (personal or Company Page) account.
// The proactive, unattended sweep of every account nearing expiry happens
// inside run-scheduler on the cron's existing schedule — this function only
// handles the user-triggered, single-account case.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const supabase = serviceClient();
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  const { account_id } = await req.json().catch(() => ({}));
  if (!account_id) return errorResponse('account_id is required', 400);

  const { data: account } = await supabase
    .from('connected_accounts')
    .select('id, workspace_id, platform')
    .eq('id', account_id)
    .maybeSingle();
  if (!account) return errorResponse('Account not found', 404);

  if (account.platform !== 'linkedin' && account.platform !== 'linkedin_page') {
    return errorResponse('Token refresh is only supported for LinkedIn accounts on this endpoint', 400);
  }

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('id')
    .eq('workspace_id', account.workspace_id)
    .eq('user_id', callerId)
    .maybeSingle();
  if (!membership) return errorResponse('Forbidden', 403);

  const result = await refreshLinkedInTokens(supabase, { accountId: account.id as string });
  if (result.refreshed === 0) {
    const reason = result.details[0]?.error ?? 'Could not refresh this account\'s token';
    // No refresh token on file means the app connection predates LinkedIn's
    // Programmatic Refresh Tokens setup (or the product isn't enabled) — the
    // only fix is reconnecting through LinkedIn OAuth again.
    const status = result.skipped > 0 ? 400 : 502;
    return errorResponse(reason, status);
  }

  return jsonResponse({ refreshed: true });
});
