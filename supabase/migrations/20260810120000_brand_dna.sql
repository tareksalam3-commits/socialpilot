/*
  Phase 2 — STEP 3: Brand DNA.

  Extends the EXISTING `brand_voice` table in place rather than creating a
  new one — per audit, `brand_voice` already covers business_name,
  description, audience, industry, writing_style, tone, keywords
  (preferred_words), negative_keywords (forbidden_words), cta_style, and
  emoji_style. This migration only adds the columns Brand DNA needs that
  don't already exist:

  - formality              text            e.g. 'casual' | 'neutral' | 'formal'
  - voice                  text            free text description of the brand's voice
  - sentence_style         text            e.g. 'short_punchy' | 'flowing' | 'mixed'
  - hook_style             text            preferred hook approach for Hook Agent (STEP 15)
  - hashtag_policy         text            free text / rule description
  - content_length         text            e.g. 'short' | 'medium' | 'long'
  - brand_values           text[]          e.g. {'transparency','craftsmanship'}
  - audience_relationship  text            e.g. 'peer' | 'authority' | 'friendly_expert'

  `emoji_style` (existing column) already serves the role of Brand DNA's
  `emoji_policy` — not renamed, to avoid touching working code paths
  (BrandVoicePage.tsx, brandVoiceRepository.ts) for a name-only change.

  Safe to re-run: every column addition uses IF NOT EXISTS.
*/

ALTER TABLE brand_voice
  ADD COLUMN IF NOT EXISTS formality text,
  ADD COLUMN IF NOT EXISTS voice text,
  ADD COLUMN IF NOT EXISTS sentence_style text,
  ADD COLUMN IF NOT EXISTS hook_style text,
  ADD COLUMN IF NOT EXISTS hashtag_policy text,
  ADD COLUMN IF NOT EXISTS content_length text,
  ADD COLUMN IF NOT EXISTS brand_values text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience_relationship text;
