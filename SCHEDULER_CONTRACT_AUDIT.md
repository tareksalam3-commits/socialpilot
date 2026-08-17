# Scheduler Contract Audit

تاريخ التدقيق: 2026-08-17

## النتيجة

وظيفة `run-scheduler` الحية ليست مصدرًا صالحًا للنشر فوق Architecture المستودع الحالية. المصدر المستعاد يقرأ ويكتب جداول legacy مثل `posts`, `post_platform_targets`, `connected_accounts`, `post_analytics`, `publishing_logs`, و`activity`، بينما العقد الحالي للمشروع يعتمد على `content`, `content_variants`, `social_accounts`, `calendar_items`, `publishing_jobs`, `post_insights`, `audit_logs`, و`notifications`.

وظيفة `scheduler-tick` الحية أقرب إلى العقد الحالي؛ فهي تقرأ `calendar_items` و`content_variants` و`social_accounts` و`social_account_tokens` وتنفذ نشرًا مكررًا داخل وظيفة مستقلة. لكنها تحتوي على secret ثابت داخل المصدر، وتكرر منطق النشر الموجود في `social-publish`، ولا تستخدم claim ذريًا لمهمة `publishing_jobs` قبل بدء النشر. لذلك لا ينبغي نشرها كما هي.

## القرار

لن يتم نشر `run-scheduler` المستعادة أو `scheduler-tick` الحالية فوق الإنتاج. سيتم بناء Scheduler صغير متوافق مع العقد الحالي، يستخدم claim ذريًا لمهمة `publishing_jobs`، ثم يستدعي `social-publish` عبر مسار داخلي موثق أو ينقل منطق النشر إلى shared module واحد. يجب إزالة الـ secret الثابت واستبداله بـ Edge Function Secret أو service-role handshake، مع اختبار 401 وduplicate execution وexpired token قبل التفعيل.

## الأدلة المحلية

- `supabase/functions/social-publish/index.ts` هو المسار القانوني الحالي للنشر، ويستخدم `content_variants`, `social_accounts`, `publishing_jobs`, `calendar_items`, `notifications`, و`audit_logs`.
- `supabase/migrations/20260816164000_0016_schedule_content_variant.sql` يحدد RPC `schedule_content_variant` ويثبت نموذج الجدولة الحالي حول `content_variants` و`calendar_items`.
- `supabase/functions/inbox-webhook/index.ts` يذكر صراحة أن النسخة السابقة كانت تستهدف `connected_accounts` و`post_platform_targets` وأن النسخة الحالية انتقلت إلى `social_accounts` و`social_account_tokens` وInbox الموحد.
- `supabase/functions/analytics-sync/index.ts` يقرأ `publishing_jobs` ويكتب `post_insights`، ما يؤكد أن analytics أيضًا يتبع العقد الجديد.

## أثر التنفيذ

هذه الفجوة ليست تحسينًا شكليًا؛ نشر Scheduler legacy سيؤدي إلى استعلامات على جداول غير موجودة أو عدم تحديث مهام `publishing_jobs`, وبالتالي قد يفشل Schedule → Publish أو يعطي نجاحًا مضللًا. الأولوية هي بناء نسخة current-schema قبل أي نشر دوري جديد.
