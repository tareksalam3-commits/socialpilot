-- Keep the constraint-backed unique index created by the original Inbox schema.
-- The hardening migration added an identical manual index, which is redundant.
DROP INDEX IF EXISTS public.uq_inbox_conversation_external;
