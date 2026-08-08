/*
# AI provider daily usage RPC

Adds a Super-Admin-only RPC that summarizes today's ai_usage_events per
provider (successful vs failed request counts since UTC midnight). This
powers the "AI credits/quota" panel on the AI Providers admin page —
ai_usage_events already logs every chat attempt (see ai-gateway's
recordUsage()), so no new tracking table or edge-function usage endpoint
is needed; this just aggregates what's already being written.

Free-tier quotas are provider-defined and mostly not exposed live via any
provider API (only OpenRouter publishes a simple, stable daily-cap rule).
This RPC intentionally returns only what we can know for certain — actual
request counts from our own logs — rather than guessing at a "remaining"
number for providers whose real caps vary by model/account and aren't
queryable.
*/

CREATE OR REPLACE FUNCTION public.get_ai_provider_daily_usage()
RETURNS TABLE(provider text, requests_today bigint, failed_today bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    e.provider,
    COUNT(*) FILTER (WHERE e.status = 'success') AS requests_today,
    COUNT(*) FILTER (WHERE e.status <> 'success') AS failed_today
  FROM ai_usage_events e
  WHERE e.created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'
  GROUP BY e.provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ai_provider_daily_usage() TO authenticated;
