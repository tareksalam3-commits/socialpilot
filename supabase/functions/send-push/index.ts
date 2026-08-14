import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type PushRequestBody = {
  user_id: string;
  notification_id?: string;
  title: string;
  body?: string;
  type?: string;
};

// Where tapping each notification type should land — kept in sync with the
// in-app routes so a push behaves exactly like tapping the bell icon would.
const typeToPath: Record<string, string> = {
  publishing_success: '/app/posts',
  publishing_failure: '/app/posts',
  ai_event: '/app/ai-history',
  account_event: '/app/accounts',
  workspace_event: '/app/workspace',
  security_alert: '/app/settings',
};

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Only ever called by the `push_on_notification` DB trigger (via pg_net)
  // using the service-role key — never directly by a browser.
  const authHeader = req.headers.get('Authorization');
  if (authHeader !== `Bearer ${serviceKey}`) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY');
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT'); // e.g. 'mailto:support@yourapp.com'
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return jsonResponse({ error: 'VAPID keys not configured' }, 500);
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabase = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const payload = (await req.json()) as PushRequestBody;
  if (!payload.user_id || !payload.title) {
    return jsonResponse({ error: 'user_id and title are required' }, 400);
  }

  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', payload.user_id);

  if (error) return jsonResponse({ error: error.message }, 500);
  if (!subscriptions || subscriptions.length === 0) {
    return jsonResponse({ sent: 0, message: 'No devices subscribed' });
  }

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body ?? '',
    url: typeToPath[payload.type ?? ''] ?? '/app/notifications',
    tag: payload.notification_id,
    notificationId: payload.notification_id,
  });

  let sent = 0;
  const staleIds: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          notificationPayload,
        );
        sent++;
      } catch (err) {
        // 404/410 = the browser/OS has permanently invalidated this
        // endpoint (uninstalled, unsubscribed at the OS level, etc.) —
        // clean it up so future notifications don't keep retrying it.
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          staleIds.push(sub.id as string);
        }
      }
    }),
  );

  if (staleIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', staleIds);
  }

  return jsonResponse({ sent, removed: staleIds.length });
});
