import { SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

/** Known credential keys the Settings > Integrations page can save, and the
 * env var each falls back to if nothing's been saved in the DB yet (so
 * existing dashboard/CLI-configured secrets keep working). */
const ENV_FALLBACK: Record<string, string> = {
  meta_app_id: 'META_APP_ID',
  meta_app_secret: 'META_APP_SECRET',
  meta_config_id: 'META_CONFIG_ID',
  linkedin_client_id: 'LINKEDIN_CLIENT_ID',
  linkedin_client_secret: 'LINKEDIN_CLIENT_SECRET',
  x_client_id: 'X_CLIENT_ID',
  x_client_secret: 'X_CLIENT_SECRET',
  threads_app_id: 'THREADS_APP_ID',
  threads_app_secret: 'THREADS_APP_SECRET',
  tiktok_client_key: 'TIKTOK_CLIENT_KEY',
  tiktok_client_secret: 'TIKTOK_CLIENT_SECRET',
  app_url: 'APP_URL',
  // Verify token Meta's webhook handshake (GET request, hub.verify_token)
  // must echo back — set on the Meta App Dashboard's Webhooks product to
  // whatever this is configured to, matching the `meta_app_secret` pattern
  // above (DB value from Settings > Integrations, falling back to env).
  meta_webhook_verify_token: 'META_WEBHOOK_VERIFY_TOKEN',
};

/** Resolves one credential: DB value (set from the app) takes priority,
 * falling back to the matching env var. Returns null if neither is set. */
export async function getCredential(supabase: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await supabase.from('platform_credentials').select('value').eq('key', key).maybeSingle();
  if (data?.value) return data.value;
  const envKey = ENV_FALLBACK[key];
  return envKey ? Deno.env.get(envKey) ?? null : null;
}

/** Resolves several credentials in one round trip. */
export async function getCredentials(supabase: SupabaseClient, keys: string[]): Promise<Record<string, string | null>> {
  const { data } = await supabase.from('platform_credentials').select('key, value').in('key', keys);
  const fromDb = new Map((data ?? []).map((row) => [row.key as string, row.value as string]));
  const result: Record<string, string | null> = {};
  for (const key of keys) {
    result[key] = fromDb.get(key) || (ENV_FALLBACK[key] ? Deno.env.get(ENV_FALLBACK[key]) ?? null : null);
  }
  return result;
}
