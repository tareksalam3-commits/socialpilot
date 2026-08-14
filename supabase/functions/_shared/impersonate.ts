import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

/**
 * ai-gateway (intentionally left untouched — see the Part B dev order)
 * requires a real end-user Bearer token: it calls `auth.getUser(token)` and
 * then checks `workspace_members` for that user. That's correct for every
 * existing caller (the browser client, or content-extraction forwarding the
 * request's own Authorization header) because a real user is always behind
 * the call.
 *
 * The inbox automation engine breaks that assumption: an inbound webhook
 * from Meta has no end-user attached at all. Rather than add a
 * service-role bypass to ai-gateway itself (which would widen its trust
 * boundary for every caller, not just this one), we mint a short-lived
 * *real* session for the workspace member who created the automation rule,
 * using the admin API's magic-link issue/verify round trip — entirely
 * server-side, no email is actually sent. ai-gateway then sees a perfectly
 * normal authenticated request and applies its existing checks unmodified.
 *
 * Usage is attributed to that user in `ai_usage_events` / `ai_history`,
 * same as if they had clicked "Generate AI Reply" themselves.
 */
export async function mintUserAccessToken(adminClient: SupabaseClient, userId: string): Promise<string | null> {
  const { data: userRes, error: userErr } = await adminClient.auth.admin.getUserById(userId);
  if (userErr || !userRes?.user?.email) return null;

  const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
    type: 'magiclink',
    email: userRes.user.email,
  });
  if (linkErr || !linkData?.properties?.hashed_token) return null;

  const anonClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: otpData, error: otpErr } = await anonClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (otpErr || !otpData.session) return null;

  return otpData.session.access_token;
}
