import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// ---------------------------------------------------------------------------
// Meta redirects the user's browser here directly (GET, no Authorization
// header) after they approve/deny access on facebook.com. We recover the
// workspace + user from the `state` row social-oauth-start created, exchange
// the code for a long-lived token, discover the user's Facebook Pages and
// any linked Instagram Business Accounts, save them as connected
// social_accounts, then redirect the browser back into the app.
// ---------------------------------------------------------------------------

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } }
);

const GRAPH_VERSION = 'v20.0';

async function getAppUrl(): Promise<string> {
  const { data } = await supabase.from('system_settings').select('value').eq('key', 'app_url').maybeSingle();
  const fromDb = typeof data?.value === 'string' ? data.value : null;
  const url = fromDb || Deno.env.get('APP_URL') || '';
  return url.replace(/\/$/, '');
}

async function redirectToApp(params: Record<string, string>): Promise<Response> {
  const appUrl = await getAppUrl();
  const target = new URL(appUrl || 'https://example.com');
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: target.toString() } });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error_message') || url.searchParams.get('error_description') || url.searchParams.get('error');

  if (oauthError) {
    return redirectToApp({ social: 'error', message: oauthError });
  }
  if (!code || !state) {
    return redirectToApp({ social: 'error', message: 'رابط رجوع غير مكتمل من Meta' });
  }

  const { data: stateRow } = await supabase
    .from('social_oauth_states')
    .select('*')
    .eq('state', state)
    .maybeSingle();

  if (!stateRow || stateRow.consumed || new Date(stateRow.expires_at).getTime() < Date.now()) {
    return redirectToApp({ social: 'error', message: 'انتهت صلاحية جلسة الربط، حاول تاني' });
  }
  await supabase.from('social_oauth_states').update({ consumed: true }).eq('state', state);

  const { data: app } = await supabase
    .from('social_platform_apps')
    .select('*')
    .eq('platform_key', stateRow.platform_key)
    .maybeSingle();
  const { data: secretRow } = await supabase
    .from('social_platform_app_secrets')
    .select('app_secret')
    .eq('platform_key', stateRow.platform_key)
    .maybeSingle();

  if (!app?.app_id || !secretRow?.app_secret) {
    return redirectToApp({ social: 'error', message: 'إعدادات ربط فيسبوك/إنستجرام غير مكتملة' });
  }

  const redirectUri = app.redirect_uri || `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/social-oauth-callback`;

  try {
    // 1. Exchange the code for a short-lived user access token.
    const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', app.app_id);
    tokenUrl.searchParams.set('client_secret', secretRow.app_secret);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('code', code);
    const tokenRes = await fetch(tokenUrl.toString());
    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(tokenJson?.error?.message ?? 'فشل تبادل رمز الدخول مع Meta');
    }

    // 2. Exchange for a long-lived user token (~60 days).
    const longUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    longUrl.searchParams.set('grant_type', 'fb_exchange_token');
    longUrl.searchParams.set('client_id', app.app_id);
    longUrl.searchParams.set('client_secret', secretRow.app_secret);
    longUrl.searchParams.set('fb_exchange_token', tokenJson.access_token);
    const longRes = await fetch(longUrl.toString());
    const longJson = await longRes.json();
    const userToken = longRes.ok && longJson.access_token ? longJson.access_token : tokenJson.access_token;
    const expiresInSec = longJson.expires_in ?? tokenJson.expires_in ?? null;
    const tokenExpiresAt = expiresInSec ? new Date(Date.now() + expiresInSec * 1000).toISOString() : null;

    // 3. Discover the user's Facebook Pages + any linked Instagram Business Account.
    const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
    pagesUrl.searchParams.set('access_token', userToken);
    pagesUrl.searchParams.set('fields', 'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}');
    const pagesRes = await fetch(pagesUrl.toString());
    const pagesJson = await pagesRes.json();
    if (!pagesRes.ok) throw new Error(pagesJson?.error?.message ?? 'تعذّر جلب صفحات فيسبوك');

    const pages: Array<Record<string, unknown>> = pagesJson.data ?? [];
    if (pages.length === 0) {
      return redirectToApp({ social: 'error', message: 'مفيش صفحات فيسبوك مرتبطة بحسابك — لازم يكون عندك صفحة فيسبوك على الأقل' });
    }

    let connectedFacebook = 0;
    let connectedInstagram = 0;

    for (const page of pages) {
      const pageId = String(page.id);
      const pageName = String(page.name ?? 'صفحة فيسبوك');
      const pageToken = String(page.access_token ?? userToken);

      const { data: fbAccount } = await supabase
        .from('social_accounts')
        .upsert({
          workspace_id: stateRow.workspace_id,
          platform: 'facebook',
          handle: pageId,
          display_name: pageName,
          status: 'connected',
          needs_reconnect: false,
          external_id: pageId,
          page_id: pageId,
          last_sync_at: new Date().toISOString(),
          metadata: { page_id: pageId },
        }, { onConflict: 'workspace_id,platform' })
        .select()
        .single();

      if (fbAccount) {
        await supabase.from('social_account_tokens').upsert({
          account_id: fbAccount.id,
          access_token: pageToken,
          token_type: 'page',
          expires_at: null, // Page access tokens derived from a long-lived user token don't expire.
          updated_at: new Date().toISOString(),
        });
        connectedFacebook += 1;
      }

      const ig = page.instagram_business_account as Record<string, unknown> | undefined;
      if (ig?.id) {
        const igId = String(ig.id);
        const igUsername = String(ig.username ?? ig.name ?? 'حساب إنستجرام');

        const { data: igAccount } = await supabase
          .from('social_accounts')
          .upsert({
            workspace_id: stateRow.workspace_id,
            platform: 'instagram',
            handle: igUsername,
            display_name: igUsername,
            status: 'connected',
            needs_reconnect: false,
            external_id: igId,
            page_id: pageId,
            ig_user_id: igId,
            last_sync_at: new Date().toISOString(),
            metadata: { linked_page_id: pageId },
          }, { onConflict: 'workspace_id,platform' })
          .select()
          .single();

        if (igAccount) {
          await supabase.from('social_account_tokens').upsert({
            account_id: igAccount.id,
            access_token: pageToken,
            token_type: 'page',
            expires_at: tokenExpiresAt,
            updated_at: new Date().toISOString(),
          });
          connectedInstagram += 1;
        }
      }
    }

    return redirectToApp({
      social: 'connected',
      platform: 'meta',
      facebook: String(connectedFacebook),
      instagram: String(connectedInstagram),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'فشل ربط الحساب';
    await supabase.from('social_platform_apps').update({ last_error: message, status: 'error' }).eq('platform_key', stateRow.platform_key);
    return redirectToApp({ social: 'error', message });
  }
});
