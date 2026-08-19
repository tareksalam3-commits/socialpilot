-- Lead Hunter: allow 'pdf' as an export format (Phase 3 — PDF export added).
-- Additive only: widens the existing CHECK constraint, no data/table changes.

ALTER TABLE public.lead_exports DROP CONSTRAINT IF EXISTS lead_exports_format_check;
ALTER TABLE public.lead_exports ADD CONSTRAINT lead_exports_format_check
  CHECK (format IN ('csv', 'xlsx', 'json', 'pdf'));
