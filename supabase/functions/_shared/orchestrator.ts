import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { nextRetryDelayMs, publishToPlatform } from './publish.ts';

export async function log(supabase: SupabaseClient, row: { workspace_id: string; post_id?: string; target_id?: string; platform?: string; event: string; message?: string }) {
  await supabase.from('publishing_logs').insert(row);
}

export async function getAccountForTarget(supabase: SupabaseClient, accountId: string, callerId: string | null) {
  const { data: account } = await supabase.from('connected_accounts').select('provider_account_id, workspace_id').eq('id', accountId).maybeSingle();
  const { data: tokens } = await supabase.rpc('get_account_tokens', { p_account_id: accountId, p_caller_id: callerId });
  if (!account || !tokens) return null;
  return { provider_account_id: account.provider_account_id as string | null, access_token: (tokens as { access_token: string | null }).access_token };
}

/** Publishes every pending/failed-but-retriable target of a post. Shared by
 * the manual "Publish Now" action (this function, with a real caller) and
 * the cron scheduler (run-scheduler, which passes callerId=null and relies
 * on the service-role key already bypassing RLS). */
export async function publishPost(supabase: SupabaseClient, post: Record<string, unknown>, callerId: string | null): Promise<'published' | 'failed'> {
  const postId = post.id as string;
  const workspaceId = post.workspace_id as string;

  const { data: targets } = await supabase.from('post_platform_targets').select('*').eq('post_id', postId);

  if (!targets || targets.length === 0) {
    const platforms = post.platforms as string[];
    for (const platform of platforms) {
      const { data: account } = await supabase
        .from('connected_accounts')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('platform', platform)
        .eq('status', 'connected')
        .maybeSingle();
      await supabase.from('post_platform_targets').insert({ post_id: postId, platform, account_id: account?.id ?? null, status: 'publishing' });
    }
  }

  const { data: allTargets } = await supabase.from('post_platform_targets').select('*').eq('post_id', postId);
  let allSuccess = true;

  for (const target of allTargets ?? []) {
    await log(supabase, { workspace_id: workspaceId, post_id: postId, target_id: target.id, platform: target.platform, event: 'attempt' });
    try {
      if (!target.account_id) throw new Error('No connected account for this platform');

      const account = await getAccountForTarget(supabase, target.account_id, callerId);
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

      await log(supabase, { workspace_id: workspaceId, post_id: postId, target_id: target.id, platform: target.platform, event: 'success' });
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

      await log(supabase, {
        workspace_id: workspaceId,
        post_id: postId,
        target_id: target.id,
        platform: target.platform,
        event: canRetry ? 'retry_scheduled' : 'gave_up',
        message,
      });
      allSuccess = false;
    }
  }

  const finalStatus = allSuccess ? 'published' : 'failed';
  await supabase.from('posts').update({
    status: finalStatus,
    published_at: allSuccess ? new Date().toISOString() : null,
    error_message: allSuccess ? null : 'Some platforms failed — see publishing logs',
    updated_at: new Date().toISOString(),
  }).eq('id', postId);

  await supabase.from('notifications').insert({
    workspace_id: workspaceId,
    user_id: post.user_id,
    type: allSuccess ? 'publishing_success' : 'publishing_failure',
    title: allSuccess ? 'Post published successfully' : 'Post publishing failed',
    message: allSuccess ? `"${post.title ?? 'Untitled'}" was published to all platforms.` : `"${post.title ?? 'Untitled'}" failed on some platforms.`,
    metadata: { post_id: postId },
  });

  await supabase.from('activity').insert({
    workspace_id: workspaceId,
    user_id: post.user_id,
    type: allSuccess ? 'post_published' : 'post_failed',
    description: allSuccess ? `Published "${post.title ?? 'Untitled'}"` : `Failed to publish "${post.title ?? 'Untitled'}"`,
    metadata: { post_id: postId },
  });

  return finalStatus;
}

