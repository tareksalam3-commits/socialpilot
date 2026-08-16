-- PostgREST upsert(on_conflict=workspace_id,variant_id) needs a
-- non-partial unique index that can be inferred by PostgreSQL.
-- The earlier partial index remains useful for non-null lookups, while this
-- full index makes the frontend plan-save upsert deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_variant_all
  ON public.calendar_items(workspace_id, variant_id);
