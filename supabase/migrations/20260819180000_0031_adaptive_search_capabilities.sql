-- Adaptive Search capabilities and optional AI-bounded controls.
-- Additive and backward-compatible: existing jobs keep their current behavior.

ALTER TABLE public.lead_hunter_settings
  ADD COLUMN IF NOT EXISTS search_categories text[] NOT NULL DEFAULT ARRAY['general']::text[],
  ADD COLUMN IF NOT EXISTS search_languages text[] NOT NULL DEFAULT ARRAY['ar-EG','en-US']::text[],
  ADD COLUMN IF NOT EXISTS search_allowed_engines text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS allow_social_search boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_site_search boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS default_time_range text,
  ADD COLUMN IF NOT EXISTS searxng_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.lead_hunter_settings.search_categories IS 'Optional category allow-list; the AI may choose only categories discovered as available by SearXNG.';
COMMENT ON COLUMN public.lead_hunter_settings.search_languages IS 'Optional language allow-list passed to SearXNG when supported.';
COMMENT ON COLUMN public.lead_hunter_settings.search_allowed_engines IS 'Optional engine allow-list; empty means the AI may use discovered engines only.';
COMMENT ON COLUMN public.lead_hunter_settings.allow_social_search IS 'Allows public social discovery through SearXNG categories or AI-generated site queries; never private access.';
COMMENT ON COLUMN public.lead_hunter_settings.allow_site_search IS 'Allows AI-generated site-specific public queries when supported by the discovered source capabilities.';
COMMENT ON COLUMN public.lead_hunter_settings.default_time_range IS 'Optional SearXNG time-range constraint, passed only when supported by the discovered instance.';
COMMENT ON COLUMN public.lead_hunter_settings.searxng_capabilities IS 'Last real capability discovery report; unknown capabilities remain unknown.';
