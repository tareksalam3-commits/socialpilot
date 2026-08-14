-- Quality Control Model Separation
--
-- الهدف: مرحلة مراجعة الجودة (Quality Control) لازم دايمًا تستخدم نموذج
-- ذكاء اصطناعي مختلف عن النموذج اللي أنشأ المحتوى (Creator/Rewrite)، عشان
-- المراجعة تكون مستقلة فعلًا وليست مجرد النموذج نفسه بيراجع نفسه.
--
-- qc_model: لو NULL، الـ Gateway (taskRouter.ts) يختار تلقائيًا أي نموذج
-- متاح غير default_model. لو محدد، لازم يكون مختلف عن default_model —
-- هذا يتحقق منه على مستوى الواجهة (AiProvidersPage) وعلى مستوى الـ Edge
-- Function (guard دفاعي إضافي في taskRouter.ts) وليس عبر CHECK constraint،
-- لأن default_model نفسه ممكن يتغيّر بعد كده وقاعدة البيانات وحدها متعرفش
-- تتحقق من "لازم يختلف عن عمود تاني بيتغيّر" بشكل موثوق مع كل تحديث.
ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS qc_model text;

COMMENT ON COLUMN ai_settings.qc_model IS
  'النموذج المخصص لمرحلة مراجعة الجودة (Quality Control) — يجب أن يختلف عن default_model دائمًا. NULL يعني: اختيار تلقائي لنموذج مختلف عند كل مراجعة.';
