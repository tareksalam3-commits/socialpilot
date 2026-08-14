import { corsHeadersFor, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';

type ConnectBody = { workspace_id?: string; access_token?: string; phone_number_id?: string; waba_id?: string; default_recipient?: string };

const GRAPH = 'https://graph.facebook.com/v21.0';

// WhatsApp Business Cloud API accounts are provisioned in Meta Business
// Manager (Embedded Signup or manual System User setup) — there's no
// redirect login dialog for it in the way Facebook/Instagram have one, so
// the permanent System User access token + phone number ID are pasted in
// here and verified live against the Cloud API before being stored.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeadersFor(req) });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const supabase = serviceClient();
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return errorResponse('Unauthorized', 401);

  const { workspace_id, access_token, phone_number_id, waba_id, default_recipient }: ConnectBody = await req.json().catch(() => ({}));
  if (!workspace_id || !access_token?.trim() || !phone_number_id?.trim()) {
    return errorResponse('workspace_id, access_token, and phone_number_id are required', 400);
  }

  const { data: membership } = await supabase.from('workspace_members').select('id').eq('workspace_id', workspace_id).eq('user_id', callerId).maybeSingle();
  if (!membership) return errorResponse('Forbidden', 403);

  const token = access_token.trim();
  const phoneNumberId = phone_number_id.trim();

  try {
    const url = new URL(`${GRAPH}/${phoneNumberId}`);
    url.searchParams.set('fields', 'verified_name,display_phone_number,quality_rating');
    url.searchParams.set('access_token', token);
    const res = await fetch(url.toString());
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? 'Could not verify this phone number ID/access token');

    const { data, error } = await supabase
      .from('connected_accounts')
      .upsert(
        {
          workspace_id,
          platform: 'whatsapp',
          handle: body.verified_name ?? body.display_phone_number ?? phoneNumberId,
          provider_account_id: phoneNumberId,
          access_token_encrypted: token,
          token_expires_at: null, // System User tokens are long-lived/permanent by design, not tied to a login session.
          status: 'connected',
          sync_status: 'synced',
          health_status: 'healthy',
          last_synced_at: new Date().toISOString(),
          metadata: {
            connected_by: callerId,
            waba_id: waba_id?.trim() || null,
            default_recipient: default_recipient?.trim() || null,
            quality_rating: body.quality_rating ?? null,
          },
        },
        { onConflict: 'workspace_id,platform,provider_account_id', ignoreDuplicates: false },
      )
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    return jsonResponse({ connected: true, account_id: data.id });
  } catch (e) {
    return errorResponse(e instanceof Error ? e.message : 'Could not connect this WhatsApp Business number', 400);
  }
});
