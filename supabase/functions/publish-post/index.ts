import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

type PublishBody = {
  post_id: string;
  workspace_id: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

async function getPostTokens(supabase: ReturnType<typeof createClient>, accountId: string, callerId: string) {
  const { data, error } = await supabase.rpc('get_account_tokens', { p_account_id: accountId, p_caller_id: callerId });
  if (error || !data) return null;
  return data as { access_token: string | null; refresh_token: string | null };
}

async function publishToFacebook(accessToken: string, content: string, mediaUrls: string[]) {
  if (mediaUrls.length === 0) {
    const res = await fetch('https://graph.facebook.com/v18.0/me/feed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, access_token: accessToken }),
    });
    if (!res.ok) throw new Error(`Facebook: ${res.status} ${await res.text()}`);
    return (await res.json()).id as string;
  }
  const res = await fetch('https://graph.facebook.com/v18.0/me/photos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption: content, url: mediaUrls[0], access_token: accessToken }),
  });
  if (!res.ok) throw new Error(`Facebook: ${res.status} ${await res.text()}`);
  return (await res.json()).post_id as string;
}

async function publishToLinkedIn(accessToken: string, content: string) {
  const profileRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!profileRes.ok) throw new Error(`LinkedIn profile: ${profileRes.status}`);
  const profile = await profileRes.json();
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify({
      author: `urn:li:person:${profile.sub}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.PostContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberConnectionVisibility': 'PUBLIC' },
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn: ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}

async function publishToInstagram(accessToken: string, content: string, mediaUrls: string[]) {
  if (mediaUrls.length === 0) throw new Error('Instagram requires at least one image');
  const containerRes = await fetch('https://graph.facebook.com/v18.0/me/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: mediaUrls[0], caption: content, access_token: accessToken }),
  });
  if (!containerRes.ok) throw new Error(`Instagram: ${containerRes.status} ${await containerRes.text()}`);
  const container = await containerRes.json();
  const publishRes = await fetch('https://graph.facebook.com/v18.0/me/media_publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
  });
  if (!publishRes.ok) throw new Error(`Instagram publish: ${publishRes.status} ${await publishRes.text()}`);
  return (await publishRes.json()).id as string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify the caller's identity directly against the auth server. This avoids the
    // unreliable setSession()-with-empty-refresh-token pattern (which is async, was
    // never awaited, and left every downstream query running under the service-role
    // key with no caller identity attached).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return errorResponse('Unauthorized', 401);
    const { data: authData, error: authError } = await supabase.auth.getUser(authHeader.slice(7));
    if (authError || !authData.user) return errorResponse('Unauthorized', 401);
    const callerId = authData.user.id;

    const { post_id, workspace_id }: PublishBody = await req.json();
    if (!post_id || !workspace_id) return errorResponse('post_id and workspace_id are required', 400);

    // The service-role client bypasses RLS entirely, so membership must be checked
    // explicitly here. Without this, any authenticated user could pass any
    // workspace_id they belong to together with someone else's post_id and have
    // that post's private content published to their own connected accounts.
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspace_id)
      .eq('user_id', callerId)
      .maybeSingle();
    if (!membership) return errorResponse('Forbidden', 403);

    const { data: post, error: postError } = await supabase.from('posts').select('*').eq('id', post_id).single();
    if (postError || !post) return errorResponse('Post not found', 404);

    // Confirm the post actually belongs to the workspace the caller is a member of.
    if (post.workspace_id !== workspace_id) return errorResponse('Post not found', 404);

    await supabase.from('posts').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', post_id);

    const { data: targets } = await supabase.from('post_platform_targets').select('*').eq('post_id', post_id);

    if (!targets || targets.length === 0) {
      const platforms = post.platforms as string[];
      for (const platform of platforms) {
        const { data: account } = await supabase
          .from('connected_accounts')
          .select('id')
          .eq('workspace_id', workspace_id)
          .eq('platform', platform)
          .eq('status', 'connected')
          .maybeSingle();

        await supabase.from('post_platform_targets').insert({
          post_id,
          platform,
          account_id: account?.id ?? null,
          status: 'publishing',
        });
      }
    }

    const { data: allTargets } = await supabase.from('post_platform_targets').select('*').eq('post_id', post_id);
    let allSuccess = true;

    for (const target of allTargets ?? []) {
      try {
        if (!target.account_id) {
          await supabase.from('post_platform_targets').update({ status: 'failed', error_message: 'No connected account for this platform' }).eq('id', target.id);
          allSuccess = false;
          continue;
        }

        const tokens = await getPostTokens(supabase, target.account_id, callerId);
        if (!tokens?.access_token) {
          await supabase.from('post_platform_targets').update({ status: 'failed', error_message: 'No access token' }).eq('id', target.id);
          allSuccess = false;
          continue;
        }

        let externalId: string | null = null;
        const content = post.content;
        const mediaUrls = post.media_urls as string[];

        if (target.platform === 'facebook') {
          externalId = await publishToFacebook(tokens.access_token, content, mediaUrls);
        } else if (target.platform === 'linkedin') {
          externalId = await publishToLinkedIn(tokens.access_token, content);
        } else if (target.platform === 'instagram') {
          externalId = await publishToInstagram(tokens.access_token, content, mediaUrls);
        } else {
          await supabase.from('post_platform_targets').update({ status: 'failed', error_message: `Unsupported platform: ${target.platform}` }).eq('id', target.id);
          allSuccess = false;
          continue;
        }

        await supabase.from('post_platform_targets').update({
          status: 'published',
          external_id: externalId,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', target.id);
      } catch (e) {
        await supabase.from('post_platform_targets').update({
          status: 'failed',
          error_message: e instanceof Error ? e.message : 'Unknown error',
          updated_at: new Date().toISOString(),
        }).eq('id', target.id);
        allSuccess = false;
      }
    }

    const finalStatus = allSuccess ? 'published' : 'failed';
    await supabase.from('posts').update({
      status: finalStatus,
      published_at: allSuccess ? new Date().toISOString() : null,
      error_message: allSuccess ? null : 'Some platforms failed',
      updated_at: new Date().toISOString(),
    }).eq('id', post_id);

    await supabase.from('notifications').insert({
      workspace_id,
      user_id: callerId,
      type: allSuccess ? 'publishing_success' : 'publishing_failure',
      title: allSuccess ? 'Post published successfully' : 'Post publishing failed',
      message: allSuccess ? `"${post.title ?? 'Untitled'}" was published to all platforms.` : `"${post.title ?? 'Untitled'}" failed on some platforms.`,
      metadata: { post_id },
    });

    await supabase.from('activities').insert({
      workspace_id,
      user_id: callerId,
      type: allSuccess ? 'post_published' : 'post_failed',
      description: allSuccess ? `Published "${post.title ?? 'Untitled'}"` : `Failed to publish "${post.title ?? 'Untitled'}"`,
      metadata: { post_id },
    });

    return jsonResponse({ status: finalStatus, post_id });
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});
