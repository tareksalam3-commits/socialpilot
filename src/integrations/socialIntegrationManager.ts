/**
 * Integration Manager
 * ====================
 * Single, unified entry point the UI uses to (a) start the correct OAuth
 * flow for any platform and (b) compute a consistent connection status for
 * the Accounts screen — instead of every screen re-implementing its own
 * per-platform if/else chain.
 *
 * This module is an ORCHESTRATION layer only. It does not talk to Supabase,
 * does not know any secrets, and does not duplicate a single Edge Function.
 * Every actual network call still goes through `accountRepository`, which
 * still calls the exact same Edge Functions that already work today
 * (meta-oauth-connect, linkedin-oauth-connect, x-oauth-connect,
 * threads-oauth-connect, tiktok-oauth-connect, telegram-connect,
 * whatsapp-connect). Meta and LinkedIn's OAuth code paths are untouched —
 * this file only picks which existing function to call.
 *
 * Adding a platform later means adding one entry to REDIRECT_OAUTH_STARTERS
 * (or MANUAL_CONNECT_METHODS) plus its PlatformDefinition in
 * `constants/platforms.ts` — nothing else in the app needs to branch on the
 * platform name again.
 */
import { accountRepository } from '@/repositories/accountRepository';
import type { ConnectMethod } from '@/constants/platforms';
import type { ExtendedConnectedAccount } from '@/types/social';

/** connectMethod values that go through a redirect-based OAuth dialog. */
export type RedirectConnectMethod = 'meta_oauth' | 'linkedin_oauth' | 'x_oauth' | 'threads_oauth' | 'tiktok_oauth';

/** connectMethod values that are verified server-side from form input
 * instead of an OAuth redirect (bot token / system-user token). */
export type ManualConnectMethod = 'telegram_manual' | 'whatsapp_manual';

const REDIRECT_METHODS = new Set<RedirectConnectMethod>(['meta_oauth', 'linkedin_oauth', 'x_oauth', 'threads_oauth', 'tiktok_oauth']);
const MANUAL_METHODS = new Set<ManualConnectMethod>(['telegram_manual', 'whatsapp_manual']);

export function isRedirectConnectMethod(method: ConnectMethod): method is RedirectConnectMethod {
  return REDIRECT_METHODS.has(method as RedirectConnectMethod);
}

export function isManualConnectMethod(method: ConnectMethod): method is ManualConnectMethod {
  return MANUAL_METHODS.has(method as ManualConnectMethod);
}

/** One starter function per redirect platform. Each entry calls the exact
 * existing `accountRepository.start*OAuth` method — same Edge Function,
 * same request shape, same response shape. Nothing about how Meta or
 * LinkedIn authenticate changes; this is purely a lookup table so the UI
 * calls one function instead of five. */
const REDIRECT_OAUTH_STARTERS: Record<RedirectConnectMethod, (workspaceId: string) => Promise<string>> = {
  meta_oauth: (workspaceId) => accountRepository.startMetaOAuth(workspaceId),
  linkedin_oauth: (workspaceId) => accountRepository.startLinkedInOAuth(workspaceId),
  x_oauth: (workspaceId) => accountRepository.startXOAuth(workspaceId),
  threads_oauth: (workspaceId) => accountRepository.startThreadsOAuth(workspaceId),
  tiktok_oauth: (workspaceId) => accountRepository.startTikTokOAuth(workspaceId),
};

/** Display label per redirect connect method — used by toasts/loading
 * states so labels stay in sync with what's actually being connected
 * without a second hardcoded map living in the page component. */
export const REDIRECT_CONNECT_LABEL: Record<RedirectConnectMethod, string> = {
  meta_oauth: 'Meta (Facebook & Instagram)',
  linkedin_oauth: 'LinkedIn',
  x_oauth: 'X',
  threads_oauth: 'Threads',
  tiktok_oauth: 'TikTok',
};

/**
 * Starts the correct OAuth redirect flow for a platform's connectMethod and
 * returns the provider's authorize URL. The caller is responsible for the
 * actual `window.location.href = url` navigation (kept in the UI layer so
 * this module has no DOM/browser dependency and stays unit-testable).
 *
 * Throws a descriptive error if a connectMethod isn't wired to a redirect
 * starter (e.g. it's a manual platform) — callers should check
 * `isRedirectConnectMethod` first, exactly like the Connect button already
 * does today.
 */
export async function startOAuthConnect(connectMethod: RedirectConnectMethod, workspaceId: string): Promise<string> {
  const starter = REDIRECT_OAUTH_STARTERS[connectMethod];
  if (!starter) throw new Error(`Integration Manager: no OAuth starter registered for "${connectMethod}"`);
  return starter(workspaceId);
}

/**
 * The five states callers of this app care about (rule: Connected /
 * Disconnected / Expired / Error / needs Reconnect). Derived purely from
 * fields the DB already tracks (`status`, `health_status`,
 * `token_expires_at`) — no schema change, no new column, no migration.
 */
export type AccountDisplayStatus = 'connected' | 'expired' | 'error' | 'warning' | 'disconnected';

type StatusInput = Pick<ExtendedConnectedAccount, 'status' | 'health_status' | 'token_expires_at'>;

export function getAccountDisplayStatus(account: StatusInput): AccountDisplayStatus {
  if (account.status === 'disconnected') return 'disconnected';
  if (account.status === 'error') return 'error';

  // status === 'connected' from here on — but a stored token can still be
  // past its expiry (cron/health-check hasn't caught up yet), so check that
  // before trusting health_status.
  if (account.token_expires_at && new Date(account.token_expires_at).getTime() < Date.now()) return 'expired';

  if (account.health_status === 'error') return 'error';
  if (account.health_status === 'warning') return 'warning';
  return 'connected';
}

/** True when the Accounts page should offer a "Reconnect" action instead of
 * (or in addition to) "Refresh token" / "Sync" — i.e. the account can no
 * longer be trusted to publish without the user re-authenticating or
 * re-entering credentials. */
export function needsReconnect(account: StatusInput): boolean {
  const status = getAccountDisplayStatus(account);
  return status === 'expired' || status === 'error' || status === 'disconnected';
}

/** Mirrors the eligibility rule the Publishing Engine already applies
 * server-side (`connected_accounts.status = 'connected'` in
 * `_shared/orchestrator.ts`), so the UI never shows an account as available
 * for scheduling when the backend would in fact skip it. */
export function isAvailableForPublishing(account: StatusInput): boolean {
  return getAccountDisplayStatus(account) === 'connected';
}
