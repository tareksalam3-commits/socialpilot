-- Ensure existing Meta app configuration requests the permissions needed by
-- Facebook Page and Instagram media insights on the next OAuth reconnect.
UPDATE public.social_platform_apps
SET scopes = trim(both ',' FROM
  COALESCE(scopes, '')
  || CASE WHEN COALESCE(scopes, '') ILIKE '%read_insights%' THEN '' ELSE ',read_insights' END
  || CASE WHEN COALESCE(scopes, '') ILIKE '%instagram_manage_insights%' THEN '' ELSE ',instagram_manage_insights' END
),
updated_at = now()
WHERE platform_key = 'meta';
