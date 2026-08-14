import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { log, publishPost, retryTarget } from '../_shared/orchestrator.ts';
import { refreshMetaTokens } from '../_shared/metaRefresh.ts';
import { refreshLinkedInTokens } from '../_shared/linkedinRefresh.ts';
import { refreshXTokens } from '../_shared/xRefresh.ts';
import { refreshThreadsTokens } from '../_shared/threadsRefresh.ts';
import { refreshTikTokTokens } from '../_shared/tiktokRefresh.ts';
import { flagExpiringLinkedInAccounts } from '../_shared/accountHealth.ts';
import { syncInboundAccount } from '../_shared/inboundSync.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req: Request) => {
  try {
    return await runScheduler(req);
  } catch (e) {
    // Top-level safety net — anything not already caught by the per-phase
    // try/catch blocks below (e.g. a bad env var, a client construction
    // failure) still returns a structured JSON error instead of an opaque
    // crash, and is logged so it's visible in the function's logs.
    console.error('run-scheduler: unhandled error', e);
    return jsonResponse({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});

async function runScheduler(req: Request): Promise<Response> {
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
  // Tracks which independent phases below threw, so one broken subsystem
  // (e.g. a provider's token-refresh endpoint being down) never stops the
  // others from running on this same cron tick, and is still visible in the
  // response instead of silently swallowed.
  const phaseErrors: Record<string, string> = {};

  // Workspaces that have paused unattended automation (Automation ›
  // "Auto Publish" toggle). Manual actions (Publish Now, manual retry via
  // automation-control) are unaffected — this only gates this background pass.
  let pausedIds = new Set<string>();
  try {
    const { data: pausedWorkspaces } = await supabase
      .from('workspaces')
      .select('id')
      .eq('auto_publish_enabled', false);
    pausedIds = new Set((pausedWorkspaces ?? []).map((w) => w.id as string));
  } catch (e) {
    phaseErrors.paused_workspaces = e instanceof Error ? e.message : String(e);
  }

  // 1) Due scheduled posts.
  try {
    const { data: duePosts } = await supabase
      .from('posts')
      .select('*')
      .eq('status', 'scheduled')
      .lte('scheduled_for', now)
      .limit(25);

    for (const post of duePosts ?? []) {
      if (pausedIds.has(post.workspace_id as string)) continue;
      try {
        await supabase.from('posts').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', post.id);
        await log(supabase, { workspace_id: post.workspace_id, post_id: post.id, event: 'queued', message: 'Scheduled publish triggered by cron' });
        const status = await publishPost(supabase, post, null);
        if (status === 'published') published++;
        else failed++;
      } catch (e) {
        // One post's publish attempt throwing (rather than resolving to a
        // 'failed' status) must not stop the rest of the due-posts batch.
        failed++;
        console.error(`run-scheduler: publish threw for post ${post.id}`, e);
      }
    }
  } catch (e) {
    phaseErrors.due_posts = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: due posts phase failed', e);
  }

  // 2) Due retries — only the specific failed target, not the whole post.
  try {
    const { data: dueTargets } = await supabase
      .from('post_platform_targets')
      .select('*')
      .eq('status', 'failed')
      .not('next_retry_at', 'is', null)
      .lte('next_retry_at', now)
      .limit(50);

    for (const target of dueTargets ?? []) {
      try {
        const { data: post } = await supabase.from('posts').select('*').eq('id', target.post_id).maybeSingle();
        if (!post) continue;
        if (pausedIds.has(post.workspace_id as string)) continue;

        const ok = await retryTarget(supabase, target, post, null);
        if (ok) retried++;
        else failed++;
      } catch (e) {
        failed++;
        console.error(`run-scheduler: retry threw for target ${target.id}`, e);
      }
    }
  } catch (e) {
    phaseErrors.due_retries = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: due retries phase failed', e);
  }

  // 3) Proactively refresh Facebook/Instagram Page tokens nearing expiry so
  // scheduled posts never fail on a stale token. Runs on the same cron tick
  // as publishing — no separate schedule to configure in Supabase.
  let metaRefresh = { refreshed: 0, failed: 0 };
  try {
    metaRefresh = await refreshMetaTokens(supabase);
  } catch (e) {
    phaseErrors.meta_refresh = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: meta token refresh phase failed', e);
  }

  // 4) Same, for LinkedIn (personal + Company Page) accounts that have a
  // refresh_token on file.
  let linkedinRefresh = { refreshed: 0, failed: 0, skipped: 0 };
  try {
    linkedinRefresh = await refreshLinkedInTokens(supabase);
  } catch (e) {
    phaseErrors.linkedin_refresh = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: linkedin token refresh phase failed', e);
  }

  // 4b) Same idea for X, Threads, and TikTok — each keeps a scheduled post
  // from ever failing on a token that simply expired between cron ticks.
  // Telegram (bot tokens) and WhatsApp (System User tokens) don't expire on
  // a schedule, so they have nothing to refresh here.
  let xRefresh = { refreshed: 0, failed: 0 };
  try {
    xRefresh = await refreshXTokens(supabase);
  } catch (e) {
    phaseErrors.x_refresh = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: x token refresh phase failed', e);
  }

  let threadsRefresh = { refreshed: 0, failed: 0 };
  try {
    threadsRefresh = await refreshThreadsTokens(supabase);
  } catch (e) {
    phaseErrors.threads_refresh = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: threads token refresh phase failed', e);
  }

  let tiktokRefresh = { refreshed: 0, failed: 0 };
  try {
    tiktokRefresh = await refreshTikTokTokens(supabase);
  } catch (e) {
    phaseErrors.tiktok_refresh = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: tiktok token refresh phase failed', e);
  }

  // 5) Pull platform-owned analytics, comments, DMs, and replies into the
  // existing normalized tables. This is deliberately on the existing scheduler
  // tick so publishing/scheduling keep one operational entry point.
  const inboundSync = { accounts: 0, analytics: 0, conversations: 0, messages: 0, warnings: 0 };
  try {
    const { data: accounts } = await supabase
      .from('connected_accounts')
      .select('id,workspace_id,platform,handle,provider_account_id,access_token_encrypted,metadata')
      .eq('status', 'connected')
      .limit(100);
    for (const account of accounts ?? []) {
      try {
        const result = await syncInboundAccount(supabase, account as never);
        inboundSync.accounts++;
        inboundSync.analytics += result.analytics;
        inboundSync.conversations += result.conversations;
        inboundSync.messages += result.messages;
        inboundSync.warnings += result.warnings.length;
      } catch (e) {
        inboundSync.warnings++;
        console.error(`run-scheduler: inbound sync failed for account ${account.id}`, e);
      }
    }
  } catch (e) {
    phaseErrors.inbound_sync = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: inbound sync phase failed', e);
  }

  // 6) Persistent assistant campaigns.  The worker claims at most one job
  // per cron tick under a database lock, so this request stays bounded while
  // campaigns continue even if the originating browser has been closed.
  let contentGeneration = { processed: false, job_id: null as string | null, error: null as string | null };
  try {
    const workerResponse = await fetch(`${supabaseUrl}/functions/v1/content-generation-worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const workerBody = await workerResponse.json().catch(() => ({})) as Record<string, unknown>;
    contentGeneration = {
      processed: workerBody.processed === true,
      job_id: typeof workerBody.job_id === 'string' ? workerBody.job_id : null,
      error: workerResponse.ok ? null : String(workerBody.error ?? `worker failed (${workerResponse.status})`),
    };
    if (contentGeneration.error) phaseErrors.content_generation = contentGeneration.error;
  } catch (e) {
    contentGeneration.error = e instanceof Error ? e.message : String(e);
    phaseErrors.content_generation = contentGeneration.error;
  }

  // 7) Automatic Audience Intelligence. This worker claims one persisted
  // inference job, so it can safely continue after the Brand Voice page is
  // closed and it never competes with campaign generation for browser state.
  let audienceIntelligence = { processed: false, job_id: null as string | null, error: null as string | null };
  try {
    const workerResponse = await fetch(`${supabaseUrl}/functions/v1/audience-intelligence-worker`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const workerBody = await workerResponse.json().catch(() => ({})) as Record<string, unknown>;
    audienceIntelligence = {
      processed: workerBody.processed === true,
      job_id: typeof workerBody.job_id === 'string' ? workerBody.job_id : null,
      error: workerResponse.ok ? null : String(workerBody.error ?? `worker failed (${workerResponse.status})`),
    };
    if (audienceIntelligence.error) phaseErrors.audience_intelligence = audienceIntelligence.error;
  } catch (e) {
    audienceIntelligence.error = e instanceof Error ? e.message : String(e);
    phaseErrors.audience_intelligence = audienceIntelligence.error;
  }

  // 8) LinkedIn accounts with no refresh_token can't be silently refreshed —
  // flag them warning/error as their token nears/passes expiry so the
  // Connected Accounts page surfaces the need to reconnect before a
  // scheduled post fails on it.
  try {
    await flagExpiringLinkedInAccounts(supabase);
  } catch (e) {
    phaseErrors.flag_expiring_linkedin = e instanceof Error ? e.message : String(e);
    console.error('run-scheduler: flag expiring linkedin accounts phase failed', e);
  }

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
    inbound_sync: inboundSync,
    content_generation: contentGeneration,
    audience_intelligence: audienceIntelligence,
    checked_at: now,
    ...(Object.keys(phaseErrors).length ? { phase_errors: phaseErrors } : {}),
  });
}
