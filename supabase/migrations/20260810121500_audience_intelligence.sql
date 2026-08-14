/*
  Phase 2 — STEP 4: Audience Intelligence.

  New table `audience_profiles` — checked against the existing schema
  first (per audit, nothing like this exists yet: brand_voice.audience is
  just free text, and the assistant pipeline's audienceAgent only infers a
  short per-post audience string, never persisted at workspace level).

  One row per workspace (mirrors brand_voice: same ownership model, same
  RLS pattern, seeded automatically on workspace creation so the
  repository can always UPDATE rather than needing upsert logic).

  This is intentionally the STRUCTURED persona spec section 9 asks for —
  persona / pain_points / desires / motivations / objections /
  awareness_level / interests / preferred_content / language_style /
  purchase_intent — tied to the Workspace, not to a single AI request.
*/

CREATE TABLE IF NOT EXISTS audience_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  persona text,
  pain_points text[] NOT NULL DEFAULT '{}',
  desires text[] NOT NULL DEFAULT '{}',
  motivations text[] NOT NULL DEFAULT '{}',
  objections text[] NOT NULL DEFAULT '{}',
  awareness_level text CHECK (
    awareness_level IS NULL OR awareness_level IN
    ('unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware')
  ),
  interests text[] NOT NULL DEFAULT '{}',
  preferred_content text[] NOT NULL DEFAULT '{}',
  language_style text,
  purchase_intent text CHECK (purchase_intent IS NULL OR purchase_intent IN ('low', 'medium', 'high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audience_profiles ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_audience_profiles_workspace_id ON audience_profiles(workspace_id);

-- Same membership/ownership RLS shape as brand_voice.
DROP POLICY IF EXISTS "select_membership_audience_profiles" ON audience_profiles;
CREATE POLICY "select_membership_audience_profiles" ON audience_profiles FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = audience_profiles.workspace_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "insert_membership_audience_profiles" ON audience_profiles;
CREATE POLICY "insert_membership_audience_profiles" ON audience_profiles FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = audience_profiles.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "update_membership_audience_profiles" ON audience_profiles;
CREATE POLICY "update_membership_audience_profiles" ON audience_profiles FOR UPDATE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = audience_profiles.workspace_id AND w.owner_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = audience_profiles.workspace_id AND w.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "delete_membership_audience_profiles" ON audience_profiles;
CREATE POLICY "delete_membership_audience_profiles" ON audience_profiles FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM workspaces w WHERE w.id = audience_profiles.workspace_id AND w.owner_id = auth.uid())
  );

-- Extend the existing workspace-creation trigger to seed audience_profiles
-- too, the same way it already seeds brand_voice. Re-declaring the
-- function (CREATE OR REPLACE) rather than adding a second trigger, since
-- on_workspace_ai_setup already exists for exactly this "seed a per-
-- workspace AI-related row" purpose.
CREATE OR REPLACE FUNCTION public.handle_workspace_ai_setup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.brand_voice (workspace_id) VALUES (NEW.id) ON CONFLICT (workspace_id) DO NOTHING;
  INSERT INTO public.audience_profiles (workspace_id) VALUES (NEW.id) ON CONFLICT (workspace_id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Backfill: seed audience_profiles for every workspace that already
-- exists (the trigger only fires on new INSERTs).
INSERT INTO public.audience_profiles (workspace_id)
SELECT w.id FROM public.workspaces w
ON CONFLICT (workspace_id) DO NOTHING;
