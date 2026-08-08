/*
# Extended Platform Integrations — X, Threads, TikTok, Telegram, WhatsApp Business

## Changes
- `oauth_states.platform` CHECK widened to also allow 'x', 'threads', 'tiktok'
  (the three new platforms that use a redirect-based OAuth2 dance, same as
  meta/linkedin already did).
- `oauth_states.code_verifier` — new nullable column. X and TikTok both
  require PKCE; the verifier generated at connect time has to survive until
  the callback, and edge functions are stateless between invocations, so it
  rides along on the same short-lived state row already used for CSRF.
- Telegram and WhatsApp Business connect directly (bot token / System User
  token respectively) rather than through a redirect, so they need no
  oauth_states entry at all — nothing to add for them here.

## Security
- Same RLS posture as the existing oauth_states policies: no new policies
  needed, the column addition inherits them.
*/

ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_platform_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_platform_check
  CHECK (platform IN ('meta', 'linkedin', 'x', 'threads', 'tiktok'));

ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS code_verifier text;
