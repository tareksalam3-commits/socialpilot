-- Brand Voice fields are explicit so prompts and UI cannot silently discard them.
ALTER TABLE public.brand_dna
  ADD COLUMN IF NOT EXISTS positioning text,
  ADD COLUMN IF NOT EXISTS preferred_phrases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS forbidden_phrases text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cta_style text;

CREATE INDEX IF NOT EXISTS idx_brand_dna_workspace_status
  ON public.brand_dna(workspace_id, status);

-- brand_dna already has the member-based RLS policies from 0001. Re-state the
-- policy shape defensively so future environments keep the same security rule.
ALTER TABLE public.brand_dna ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bd_select_member" ON public.brand_dna;
CREATE POLICY "bd_select_member" ON public.brand_dna FOR SELECT
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bd_insert_member" ON public.brand_dna;
CREATE POLICY "bd_insert_member" ON public.brand_dna FOR INSERT
  TO authenticated WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bd_update_member" ON public.brand_dna;
CREATE POLICY "bd_update_member" ON public.brand_dna FOR UPDATE
  TO authenticated USING (public.user_workspace_role(workspace_id) IS NOT NULL)
  WITH CHECK (public.user_workspace_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS "bd_delete_member" ON public.brand_dna;
CREATE POLICY "bd_delete_member" ON public.brand_dna FOR DELETE
  TO authenticated USING (public.user_workspace_role(workspace_id) IN ('owner','admin'));

COMMENT ON COLUMN public.brand_dna.positioning IS 'Short positioning statement used by content and strategy agents.';
COMMENT ON COLUMN public.brand_dna.preferred_phrases IS 'Phrases the brand prefers in generated content.';
COMMENT ON COLUMN public.brand_dna.forbidden_phrases IS 'Phrases that generated content must not use.';
COMMENT ON COLUMN public.brand_dna.cta_style IS 'Preferred call-to-action style for generated content.';

UPDATE public.brand_dna
SET
  positioning = COALESCE(positioning, identity->>'positioning'),
  preferred_phrases = CASE
    WHEN cardinality(preferred_phrases) = 0 AND jsonb_typeof(tone->'preferred_phrases') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(tone->'preferred_phrases'))
    ELSE preferred_phrases
  END,
  forbidden_phrases = CASE
    WHEN cardinality(forbidden_phrases) = 0 AND jsonb_typeof(tone->'forbidden_phrases') = 'array'
      THEN ARRAY(SELECT jsonb_array_elements_text(tone->'forbidden_phrases'))
    ELSE forbidden_phrases
  END,
  cta_style = COALESCE(cta_style, content->>'cta_style', tone->>'cta_style')
WHERE positioning IS NULL
   OR cardinality(preferred_phrases) = 0
   OR cardinality(forbidden_phrases) = 0
   OR cta_style IS NULL;
