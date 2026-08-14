-- Adds Country to workspaces, sitting above Content Language in Workspace
-- Settings. When Content Language is Arabic, the Arabic dialect used for
-- every generated/rewritten post is resolved from this field (see
-- src/constants/dialects.ts) rather than being a separate manual choice.
--
-- Existing workspaces default to Egypt so the system's current behavior
-- (Professional Egyptian Arabic everywhere) is unchanged for them.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'EG';

COMMENT ON COLUMN public.workspaces.country IS
  'ISO 3166-1 alpha-2 country code. Drives Arabic dialect resolution when language = ''ar'' (see src/constants/dialects.ts). Defaults to Egypt (EG).';
