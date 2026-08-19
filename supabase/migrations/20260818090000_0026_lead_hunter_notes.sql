-- Lead Hunter — additive fix: `notes` field required by the Lead intake
-- schema (manual notes on a lead, separate from lead_campaign_members.notes
-- which is campaign-specific) was missing from 0024. Additive only.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS notes text;

CREATE INDEX IF NOT EXISTS idx_lead_tag_links_ws_lead ON public.lead_tag_links(workspace_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_leads_ws_updated ON public.leads(workspace_id, updated_at DESC);

COMMENT ON COLUMN public.leads.notes IS 'Free-text sales notes entered by workspace members; never populated automatically.';
