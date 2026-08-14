import { corsHeadersFor, errorResponse, getCallerId, jsonResponse, serviceClient } from '../_shared/oauth.ts';

// Regular clients can't read `auth.users` (email, last sign-in, ban status)
// under RLS — only a service-role key can. This function verifies the
// caller is a Super Admin, then joins auth.users with `profiles` and
// `workspace_members` so the admin panel can render "All Users" and act on
// them (change platform role, ban/unban) in one place.

async function requireSuperAdmin(supabase: ReturnType<typeof serviceClient>, req: Request) {
  const callerId = await getCallerId(supabase, req);
  if (!callerId) return { callerId: null, error: errorResponse('Unauthorized', 401) };
  const { data: profile } = await supabase
    .from('profiles')
    .select('platform_role')
    .eq('user_id', callerId)
    .maybeSingle();
  if (profile?.platform_role !== 'super_admin') {
    return { callerId: null, error: errorResponse('Super Admin access required', 403) };
  }
  return { callerId, error: null };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeadersFor(req) });

  const supabase = serviceClient();
  const { callerId, error } = await requireSuperAdmin(supabase, req);
  if (error) return error;

  if (req.method === 'GET') {
    // Paginate through auth.users (default page size 50; admin panel can
    // request more pages as needed).
    const url = new URL(req.url);
    const page = Number(url.searchParams.get('page') ?? '1');
    const perPage = Math.min(Number(url.searchParams.get('perPage') ?? '100'), 200);

    const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers({ page, perPage });
    if (listError) return errorResponse(listError.message, 500);

    const userIds = usersPage.users.map((u) => u.id);
    const [{ data: profiles }, { data: memberships }] = await Promise.all([
      supabase.from('profiles').select('user_id, full_name, platform_role, created_at').in('user_id', userIds),
      supabase
        .from('workspace_members')
        .select('user_id, role, workspaces(id, name)')
        .in('user_id', userIds),
    ]);

    const profileByUser = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    const membershipsByUser = new Map<string, { id: string; name: string; role: string }[]>();
    for (const m of (memberships ?? []) as { user_id: string; role: string; workspaces: { id: string; name: string } | null }[]) {
      if (!m.workspaces) continue;
      const list = membershipsByUser.get(m.user_id) ?? [];
      list.push({ id: m.workspaces.id, name: m.workspaces.name, role: m.role });
      membershipsByUser.set(m.user_id, list);
    }

    const rows = usersPage.users.map((u) => {
      const p = profileByUser.get(u.id);
      return {
        user_id: u.id,
        email: u.email ?? '',
        full_name: p?.full_name ?? null,
        platform_role: p?.platform_role ?? 'user',
        created_at: p?.created_at ?? u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null,
        banned: !!(u as unknown as { banned_until?: string }).banned_until,
        workspaces: membershipsByUser.get(u.id) ?? [],
      };
    });

    return jsonResponse({ users: rows, page, perPage, total: usersPage.total ?? rows.length });
  }

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const { action, userId } = body as { action: string; userId: string };
    if (!userId) return errorResponse('userId is required', 400);

    if (action === 'set_platform_role') {
      const role = body.role === 'super_admin' ? 'super_admin' : 'user';
      const { error: updateError } = await supabase.from('profiles').update({ platform_role: role }).eq('user_id', userId);
      if (updateError) return errorResponse(updateError.message, 500);
      await supabase.from('audit_logs').insert({
        actor_id: callerId,
        action: 'user.set_platform_role',
        entity_type: 'user',
        entity_id: userId,
        metadata: { role },
      });
      return jsonResponse({ ok: true });
    }

    if (action === 'ban' || action === 'unban') {
      const { error: banError } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: action === 'ban' ? '87600h' : 'none',
      });
      if (banError) return errorResponse(banError.message, 500);
      await supabase.from('audit_logs').insert({
        actor_id: callerId,
        action: `user.${action}`,
        entity_type: 'user',
        entity_id: userId,
        metadata: {},
      });
      return jsonResponse({ ok: true });
    }

    return errorResponse('Unknown action', 400);
  }

  return errorResponse('Method not allowed', 405);
});
