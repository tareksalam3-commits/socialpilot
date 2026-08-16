import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// ---------------------------------------------------------------------------
// Workspace member management. Runs with the service role only to read
// auth.users emails (not exposed to clients directly) and to look up a user
// by email when inviting. Every action still re-checks the caller's actual
// membership/role against public.workspace_members — same rules the RLS
// policies enforce for direct client access — so this is not a privilege
// bypass, just a way to join in emails.
// ---------------------------------------------------------------------------

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } }
);

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

type Action =
  | { action: 'list'; workspaceId: string }
  | { action: 'invite'; workspaceId: string; email: string }
  | { action: 'remove'; workspaceId: string; memberId: string };

async function requireCaller(req: Request): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, response: jsonRes(401, { error: 'Missing authentication token' }) };
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return { ok: false, response: jsonRes(401, { error: 'Invalid or expired token' }) };
  return { ok: true, userId: userData.user.id };
}

async function getCallerRole(workspaceId: string, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.role ?? null;
}

// auth.users isn't reachable via the normal client — go through the admin
// API and page through until we find a match or run out of users.
async function findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
  const target = email.trim().toLowerCase();
  let page = 1;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return null;
    const match = data.users.find((u) => (u.email ?? '').toLowerCase() === target);
    if (match) return { id: match.id, email: match.email ?? '' };
    if (data.users.length < 200) return null;
    page += 1;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes(405, { error: 'Method not allowed' });

  const caller = await requireCaller(req);
  if (!caller.ok) return caller.response;

  let body: Action;
  try {
    body = await req.json();
  } catch {
    return jsonRes(400, { error: 'Invalid JSON body' });
  }
  if (!body.workspaceId) return jsonRes(400, { error: 'workspaceId is required' });

  const callerRole = await getCallerRole(body.workspaceId, caller.userId);
  if (!callerRole) return jsonRes(403, { error: 'You are not a member of this workspace' });

  switch (body.action) {
    case 'list': {
      const { data: members, error } = await supabase
        .from('workspace_members')
        .select('id, user_id, role, created_at')
        .eq('workspace_id', body.workspaceId)
        .order('created_at', { ascending: true });
      if (error || !members) return jsonRes(500, { error: 'تعذّر تحميل أعضاء المساحة' });

      const withEmails = await Promise.all(
        members.map(async (m) => {
          const { data } = await supabase.auth.admin.getUserById(m.user_id);
          return { ...m, email: data?.user?.email ?? null };
        })
      );
      return jsonRes(200, { members: withEmails });
    }

    case 'invite': {
      if (callerRole !== 'owner' && callerRole !== 'admin') {
        return jsonRes(403, { error: 'دعوة أعضاء جدد متاحة لمالك أو أدمن المساحة فقط' });
      }
      if (!body.email?.trim()) return jsonRes(400, { error: 'البريد الإلكتروني مطلوب' });

      const found = await findUserByEmail(body.email);
      if (!found) {
        return jsonRes(404, {
          error: 'مفيش حساب مسجّل بهذا البريد الإلكتروني. لازم الشخص يعمل حساب في التطبيق الأول، وبعدين تقدر تضيفه.',
        });
      }

      const { data: existing } = await supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', body.workspaceId)
        .eq('user_id', found.id)
        .maybeSingle();
      if (existing) return jsonRes(409, { error: 'العضو ده منضم للمساحة بالفعل' });

      const { error: insertError } = await supabase
        .from('workspace_members')
        .insert({ workspace_id: body.workspaceId, user_id: found.id, role: 'member' });
      if (insertError) return jsonRes(500, { error: 'تعذّر إضافة العضو' });

      return jsonRes(200, { ok: true, email: found.email });
    }

    case 'remove': {
      if (callerRole !== 'owner' && callerRole !== 'admin') {
        return jsonRes(403, { error: 'إزالة الأعضاء متاحة لمالك أو أدمن المساحة فقط' });
      }
      const { data: target } = await supabase
        .from('workspace_members')
        .select('id, user_id, role')
        .eq('id', body.memberId)
        .eq('workspace_id', body.workspaceId)
        .maybeSingle();
      if (!target) return jsonRes(404, { error: 'العضو غير موجود' });
      if (target.role === 'owner') return jsonRes(400, { error: 'لا يمكن إزالة مالك المساحة' });

      const { error: deleteError } = await supabase.from('workspace_members').delete().eq('id', body.memberId);
      if (deleteError) return jsonRes(500, { error: 'تعذّر إزالة العضو' });
      return jsonRes(200, { ok: true });
    }

    default:
      return jsonRes(400, { error: 'Unknown action' });
  }
});
