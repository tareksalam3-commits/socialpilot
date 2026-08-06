import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { log, publishPost, retryTarget } from '../_shared/orchestrator.ts';
import { refreshMetaTokens } from '../_shared/metaRefresh.ts';
import { refreshLinkedInTokens } from '../_shared/linkedinRefresh.ts';
import { refreshXTokens } from '../_shared/xRefresh.ts';
import { refreshThreadsTokens } from '../_shared/threadsRefresh.ts';
import { refreshTikTokTokens } from '../_shared/tiktokRefresh.ts';
import { flagExpiringLinkedInAccounts } from '../_shared/accountHealth.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // This function is only ever meant to be called by the pg_cron job (via
  // pg_net) using the service-role key, never directly by a browser — so we
  // gate on that instead of a user session.
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const now = new Date().toISOString();
  let published = 0;
  let retried = 0;
  let failed = 0;

  // Workspaces that have paused unattended automation (Automation ›
  // "Auto Publish" toggle). Manual actions (Publish Now, manual retry via
  // automation-control) are unaffected — this only gates this background pass.
  const { data: pausedWorkspaces } = await supabase
    .from('workspaces')
    .select('id')
    .eq('auto_publish_enabled', false);
  const pausedIds = new Set((pausedWorkspaces ?? []).map((w) => w.id as string));

  // 1) Due scheduled posts.
  const { data: duePosts } = await supabase
    .from('posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .limit(25);

  for (const post of duePosts ?? []) {
    if (pausedIds.has(post.workspace_id as string)) continue;
    await supabase.from('posts').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', post.id);
    await log(supabase, { workspace_id: post.workspace_id, post_id: post.id, event: 'queued', message: 'Scheduled publish triggered by cron' });
    const status = await publishPost(supabase, post, null);
    if (status === 'published') published++;
    else failed++;
  }

  // 2) Due retries — only the specific failed target, not the whole post.
  const { data: dueTargets } = await supabase
    .from('post_platform_targets')
    .select('*')
    .eq('status', 'failed')
    .not('next_retry_at', 'is', null)
    .lte('next_retry_at', now)
    .limit(50);

  for (const target of dueTargets ?? []) {
    const { data: post } = await supabase.from('posts').select('*').eq('id', target.post_id).maybeSingle();
    if (!post) continue;
    if (pausedIds.has(post.workspace_id as string)) continue;

    const ok = await retryTarget(supabase, target, post, null);
    if (ok) retried++;
    else failed++;
  }

  // 3) Proactively refresh Facebook/Instagram Page tokens nearing expiry so
  // scheduled posts never fail on a stale token. Runs on the same cron tick
  // as publishing — no separate schedule to configure in Supabase.
  const metaRefresh = await refreshMetaTokens(supabase);

  // 4) Same, for LinkedIn (personal + Company Page) accounts that have a
  // refresh_token on file.
  const linkedinRefresh = await refreshLinkedInTokens(supabase);

  // 4b) Same idea for X, Threads, and TikTok — each keeps a scheduled post
  // from ever failing on a token that simply expired between cron ticks.
  // Telegram (bot tokens) and WhatsApp (System User tokens) don't expire on
  // a schedule, so they have nothing to refresh here.
  const xRefresh = await refreshXTokens(supabase);
  const threadsRefresh = await refreshThreadsTokens(supabase);
  const tiktokRefresh = await refreshTikTokTokens(supabase);

  // 5) LinkedIn accounts with no refresh_token can't be silently refreshed —
  // flag them warning/error as their token nears/passes expiry so the
  // Connected Accounts page surfaces the need to reconnect before a
  // scheduled post fails on it.
  await flagExpiringLinkedInAccounts(supabase);

  return jsonResponse({
    published,
    retried,
    failed,
    meta_tokens_refreshed: metaRefresh.refreshed,
    meta_tokens_refresh_failed: metaRefresh.failed,
    linkedin_tokens_refreshed: linkedinRefresh.refreshed,
    linkedin_tokens_refresh_failed: linkedinRefresh.failed,
    linkedin_tokens_skipped: linkedinRefresh.skipped,
    x_tokens_refreshed: xRefresh.refreshed,
    x_tokens_refresh_failed: xRefresh.failed,
    threads_tokens_refreshed: threadsRefresh.refreshed,
    threads_tokens_refresh_failed: threadsRefresh.failed,
    tiktok_tokens_refreshed: tiktokRefresh.refreshed,
    tiktok_tokens_refresh_failed: tiktokRefresh.failed,
    checked_at: now,
  });
});
