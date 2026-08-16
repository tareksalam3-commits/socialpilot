-- ربط تيليجرام: يوسّع social_platform_apps.platform_key عشان يقبل 'telegram'
-- (وبقية المنصات المستقبلية) وبيزرع صف الإعدادات بتاعه.
--
-- تيليجرام مختلف عن Meta/LinkedIn: مفيش OAuth تفاعلي، فيه بوت واحد مشترك
-- (Bot Token واحد يتحط من الـ Super Admin) وكل مساحة عمل بتضيف نفس البوت
-- كـ Admin على قناتها، وبعدين بنتأكد من صلاحيته عبر Bot API. الحقل app_id
-- بيتخزن فيه يوزر البوت (من غير @) والحقل app_secret بيتخزن فيه الـ Bot Token.

DO $$
BEGIN
  ALTER TABLE public.social_platform_apps DROP CONSTRAINT IF EXISTS social_platform_apps_platform_key_check;
  ALTER TABLE public.social_platform_apps ADD CONSTRAINT social_platform_apps_platform_key_check
    CHECK (platform_key IN ('meta', 'linkedin', 'telegram', 'x', 'tiktok', 'threads', 'whatsapp'));
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

INSERT INTO public.social_platform_apps (platform_key, display_name, scopes)
VALUES ('telegram', 'تيليجرام', '')
ON CONFLICT (platform_key) DO NOTHING;
