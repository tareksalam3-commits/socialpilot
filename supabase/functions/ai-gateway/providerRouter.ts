// Provider Router — decides, for a given request, which providers are
// actually usable (have a key configured) and in what order to try them.
// It owns the two platform-wide config reads (ai_provider_keys, ai_settings)
// so the Fallback Engine never touches Supabase directly for configuration.

import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { PROVIDER_CATALOG, type AiProvider, type ProviderKeyRow } from './modelRegistry.ts';

// Provider keys and AI settings are platform-wide (a single shared pool of
// keys with dynamic fallback), not per-workspace — so no workspace_id filter
// here. Service-role client bypasses RLS, so this reads ai_provider_keys
// directly — no SECURITY DEFINER RPC needed for the gateway's own use (the
// RPC `list_ai_provider_status` exists only for the Super Admin browser
// client, which has no SELECT access to this table at all).
export async function getProviderKeys(supabase: ReturnType<typeof createClient>): Promise<Map<AiProvider, ProviderKeyRow>> {
  const { data, error } = await supabase
    .from('ai_provider_keys')
    .select('provider, api_key_encrypted, base_url, account_id');
  const map = new Map<AiProvider, ProviderKeyRow>();
  if (error || !data) return map;
  for (const row of data as ProviderKeyRow[]) map.set(row.provider, row);
  return map;
}

export async function getAiSettings(supabase: ReturnType<typeof createClient>) {
  const { data, error } = await supabase
    .from('ai_settings')
    .select('provider, default_model, qc_model, temperature, max_tokens, streaming, free_only_mode, mode, model_selection, last_successful_model, last_successful_provider')
    .maybeSingle();
  if (error) return null;
  return data;
}

// Ordered list of providers to actually try for this request: the caller's
// preferred provider first (if it has a key configured), then every other
// configured provider, in catalog order. Providers with no key saved are
// skipped entirely — that's the "switch to one that works, invisibly to the
// user" behavior. When model_selection is 'manual', the chain is pinned to
// just the preferred provider by the caller (see fallbackEngine) — this
// function itself always builds the full fallback-capable chain.
export function buildProviderChain(preferred: string | undefined, keys: Map<AiProvider, ProviderKeyRow>): AiProvider[] {
  const configured = PROVIDER_CATALOG.map((p) => p.id).filter((id) => !!keys.get(id)?.api_key_encrypted);
  const chain: AiProvider[] = [];
  if (preferred && configured.includes(preferred as AiProvider)) chain.push(preferred as AiProvider);
  for (const id of configured) if (!chain.includes(id)) chain.push(id);
  return chain;
}
