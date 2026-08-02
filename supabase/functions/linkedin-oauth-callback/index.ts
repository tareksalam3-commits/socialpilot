import { redirectToApp, serviceClient } from '../_shared/oauth.ts';
import { getCredential } from '../_shared/credentials.ts';

type LinkedInOption = {
  type: 'personal' | 'organization';
  id: string;
  name: string;
  access_token: string;
  expires_at: string;
  // Only present when LinkedIn's "Programmatic Refresh Tokens" product is
  // enabled on the app — lets us silently refresh instead of forcing the
  // user back through the OAuth dialog every ~60 days.
  refresh_token?: string;
};

async function exchangeCode(clientId: string, clientSecret: string, redirectUri: string, code: string) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`token exchange failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string; refresh_token_expires_in?: number };
}

async function fetchProfile(accessToken: string) {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`profile fetch failed: ${await res.text()}`);
  return (await res.json()) as { sub: string; name: string };
}

/** Organizations the user administers. Requires the Community Management API
 * product; if the app doesn't have it, this quietly returns an empty list so
 * the personal profile is still connectable. */
async function fetchAdminOrganizations(accessToken: string): Promise<LinkedInOption[]> {
  try {
    const res = await fetch(
      'https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organization~(id,localizedName)))',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': '202401',
          'X-Restli-Protocol-Version': '2.0.0',
        },
      },
    );
    if (!res.ok) return [];
    const body = await res.json();
    const elements = (body.elements ?? []) as Array<Record<string, unknown>>;
    return elements
      .map((el) => el['organization~'] as Record<string, unknown> | undefined)
      .filter((org): org is Record<string, unknown> => !!org)
      .map((org) => ({
        type: 'organization' as const,
        id: `urn:li:organization:${org.id}`,
        name: org.localizedName as string,
        access_token: accessToken,
        expires_at: '',
      }));
  } catch {
    return [];
  }
}

Deno.serve(async (req: Request) => {
  const supabase = serviceClient();
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');

  if (oauthError) return await redirectToApp(supabase, { platform: 'linkedin', error: oauthError });
  if (!code || !state) return await redirectToApp(supabase, { platform: 'linkedin', error: 'missing_code_or_state' });

  const clientId = await getCredential(supabase, 'linkedin_client_id');
  const clientSecret = await getCredential(supabase, 'linkedin_client_secret');
  if (!clientId || !clientSecret) return await redirectToApp(supabase, { platform: 'linkedin', error: 'server_not_configured' });

  const { data: stateRow } = await supabase.from('oauth_states').select('*').eq('state', state).eq('platform', 'linkedin').maybeSingle();
  if (!stateRow || new Date(stateRow.expires_at as string) < new Date()) {
    return await redirectToApp(supabase, { platform: 'linkedin', error: 'invalid_or_expired_state' });
  }
  await supabase.from('oauth_states').delete().eq('id', stateRow.id as string);

  const functionsUrl = Deno.env.get('SUPABASE_URL')!.replace('.supabase.co', '.supabase.co/functions/v1');
  const redirectUri = `${functionsUrl}/linkedin-oauth-callback`;

  try {
    const token = await exchangeCode(clientId, clientSecret, redirectUri, code);
    const expiresAt = new Date(Date.now() + token.expires_in * 1000).toISOString();
    const profile = await fetchProfile(token.access_token);
    const organizations = await fetchAdminOrganizations(token.access_token);

    // Organizations post through the same 3-legged user token as the
    // personal profile, so the same refresh_token applies to both.
    const options: LinkedInOption[] = [
      {
        type: 'personal',
        id: `urn:li:person:${profile.sub}`,
        name: profile.name,
        access_token: token.access_token,
        expires_at: expiresAt,
        refresh_token: token.refresh_token,
      },
      ...organizations.map((org) => ({ ...org, expires_at: expiresAt, refresh_token: token.refresh_token })),
    ];

    const { data: selection, error } = await supabase
      .from('oauth_pending_selections')
      .insert({
        workspace_id: stateRow.workspace_id as string,
        user_id: stateRow.user_id as string,
        platform: 'linkedin',
        options,
      })
      .select('id')
      .single();
    if (error || !selection) throw new Error('could not store selection');

    return await redirectToApp(supabase, { platform: 'linkedin', selection: selection.id as string });
  } catch (e) {
    return await redirectToApp(supabase, { platform: 'linkedin', error: e instanceof Error ? e.message : 'unknown_error' });
  }
});
