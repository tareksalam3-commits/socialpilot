-- ربط لينكدإن: seed لصف الإعدادات فى social_platform_apps.
-- الجدول والـ check constraints كانت بالفعل بتدعم 'linkedin' من قبل، محتاج بس الصف.
INSERT INTO public.social_platform_apps (platform_key, display_name, scopes)
VALUES ('linkedin', 'لينكدإن', 'openid profile email w_member_social')
ON CONFLICT (platform_key) DO NOTHING;
