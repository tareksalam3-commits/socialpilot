import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { getAccountForTarget, log, publishPost } from '../_shared/orchestrator.ts';
import { nextRetryDelayMs, publishToPlatform } from '../_shared/publish.ts';
import { refreshMetaTokens } from '../_shared/metaRefresh.ts';

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

  // 1) Due scheduled posts.
  const { data: duePosts } = await supabase
    .from('posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .limit(25);

  for (const post of duePosts ?? []) {
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

    await log(supabase, { workspace_id: post.workspace_id, post_id: post.id, target_id: target.id, platform: target.platform, event: 'attempt', message: `Retry #${target.retry_count}` });

    try {
      if (!target.account_id) throw new Error('No connected account for this platform');
      const account = await getAccountForTarget(supabase, target.account_id, null);
      if (!account?.access_token) throw new Error('No access token for this account');

      const externalId = await publishToPlatform(target.platform, account.access_token, account.provider_account_id, post.content as string, post.media_urls as string[]);

      await supabase.from('post_platform_targets').update({
        status: 'published',
        external_id: externalId,
        published_at: new Date().toISOString(),
        error_message: null,
        next_retry_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', target.id);
      await log(supabase, { workspace_id: post.workspace_id, post_id: post.id, target_id: target.id, platform: target.platform, event: 'success' });
      retried++;

      // If every target for this post is now published, flip the post itself.
      const { data: siblings } = await supabase.from('post_platform_targets').select('status').eq('post_id', post.id);
      if (siblings?.every((s) => s.status === 'published')) {
        await supabase.from('posts').update({ status: 'published', published_at: new Date().toISOString(), error_message: null, updated_at: new Date().toISOString() }).eq('id', post.id);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      const retryCount = (target.retry_count as number) ?? 0;
      const maxRetries = (target.max_retries as number) ?? 3;
      const canRetry = retryCount < maxRetries;

      await supabase.from('post_platform_targets').update({
        status: 'failed',
        error_message: message,
        retry_count: canRetry ? retryCount + 1 : retryCount,
        next_retry_at: canRetry ? new Date(Date.now() + nextRetryDelayMs(retryCount)).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('id', target.id);

      await log(supabase, { workspace_id: post.workspace_id, post_id: post.id, target_id: target.id, platform: target.platform, event: canRetry ? 'retry_scheduled' : 'gave_up', message });
      failed++;
    }
  }

  // 3) Proactively refresh Facebook/Instagram Page tokens nearing expiry so
  // scheduled posts never fail on a stale token. Runs on the same cron tick
  // as publishing — no separate schedule to configure in Supabase.
  const metaRefresh = await refreshMetaTokens(supabase);

  return jsonResponse({
    published,
    retried,
    failed,
    meta_tokens_refreshed: metaRefresh.refreshed,
    meta_tokens_refresh_failed: metaRefresh.failed,
    checked_at: now,
  });
});
