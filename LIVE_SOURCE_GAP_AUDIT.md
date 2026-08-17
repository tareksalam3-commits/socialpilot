# Live Source Gap Audit

تاريخ الفحص: 2026-08-17

## Supabase project

- Project ref: `iqbuedqugkpxqdrzhfzn`
- Project name: `SocialPilot`

## Edge Functions

نتيجة الجرد الحي: 47 وظيفة. الوظائف المحلية في GitHub: 13 وظيفة.

### وظائف حية ممثلة محليًا

`account-sync`, `ai-admin`, `ai-gateway`, `analytics-sync`, `inbox-reply`, `inbox-webhook`, `scheduler-tick`, `social-oauth-callback`, `social-oauth-start`, `social-platform-admin`, `social-publish`, `social-telegram-connect`, `workspace-members`.

### وظائف حية غير ممثلة محليًا

`admin-secrets`, `admin-users`, `audience-intelligence-worker`, `automation-control`, `big-file-test`, `content-extraction`, `content-generation-worker`, `flat-inline-test`, `inbox-webhook-full-test`, `linkedin-oauth-callback`, `linkedin-oauth-connect`, `linkedin-token-refresh`, `meta-oauth-callback`, `meta-oauth-connect`, `meta-token-refresh`, `mid-file-test`, `oauth-selection`, `platform-credentials`, `publish-post`, `run-scheduler`, `send-push`, `test-deploy-check`, `threads-oauth-callback`, `threads-oauth-connect`, `threads-token-refresh`, `tiktok-oauth-callback`, `tiktok-oauth-connect`, `tiktok-token-refresh`, `two-files-test`, `whatsapp-connect`, `x-oauth-callback`, `x-oauth-connect`, `x-token-refresh`, `telegram-connect`.

الوظائف التي تبدو اختبارات أو أدوات نشر وليست مسارات منتج: `big-file-test`, `flat-inline-test`, `inbox-webhook-full-test`, `mid-file-test`, `test-deploy-check`, `two-files-test`.

## Schema evidence

استعلام محدود من `information_schema.columns` على مخطط `public` في مشروع SocialPilot أظهر أن البنية الحالية تستخدم:

- `social_accounts` و`social_account_tokens` لتخزين الحسابات والرموز.
- `publishing_jobs` للجدولة، مع `idempotency_key`, `status`, `attempts`, `max_attempts`, `last_error`, `scheduled_for`, `completed_at`, `external_post_id`, `platform`, `published_at`, و`last_attempt_at`.
- `notifications` بأعمدة `title`, `body`, و`payload`، وليس `message` و`metadata`.
- لم تظهر جداول `connected_accounts`, `posts`, `post_platform_targets`, `automation_rules`, أو `automation_logs` في نتيجة الاستعلام المحدود.

## Critical finding

مصدر `automation-control` الحي يعتمد على Architecture قديمة تشمل `connected_accounts`, `posts`, `post_platform_targets`, و`_shared/orchestrator.ts`. لذلك لا يجوز نشره أو نسخه كما هو فوق المسارات الحالية؛ يجب إما بناء محول متوافق مع `social_accounts` و`publishing_jobs` أو إبقاء الوظيفة الحية دون استبدال حتى يتم تحديد عقدها الكامل.

## Source references

- Supabase live Edge Function inventory: `/home/ubuntu/.mcp/tool-results/2026-08-17_07-55-45.429593422_supabase_list_edge_functions_8d61d837.json`
- Supabase schema query result: `/home/ubuntu/.mcp/tool-results/2026-08-17_07-56-39.350758114_supabase_execute_sql_4fe3992c.json`
- Live `automation-control` source: `/home/ubuntu/.mcp/tool-results/2026-08-17_07-56-16.076087452_supabase_get_edge_function_95ddf9f9.json`

## OAuth source evidence

تمت استعادة `meta-oauth-connect` و`meta-oauth-callback` من Supabase الحي. الإصداران الحاليان يستخدمان:

- `oauth_states` مع `state`, `workspace_id`, `user_id`, `platform`, `expires_at` وقراءة/حذف state بعد callback.
- `oauth_pending_selections` لتخزين صفحات Meta مؤقتًا قبل اختيار الصفحة/حساب Instagram.
- `platform_credentials` لتخزين `meta_app_id`, `meta_app_secret`, `meta_config_id`, و`app_url` مع fallback إلى environment variables.
- `meta-oauth-connect` يطلب `workspace_id` ويعيد URL فقط بعد التحقق من JWT وعضوية مساحة العمل.
- `meta-oauth-callback` يعمل بدون JWT لأن مزود OAuth يستدعيه، لكنه يحمي العملية عبر state قصير الأجل ويستهلك state.

يوجد اختلاف واضح عن المسار المحلي `social-oauth-start` الذي يستخدم `social_oauth_states` و`social_platform_apps` ويدعم `meta`, `linkedin`, و`x` عبر وظيفة عامة. لذلك لن يتم استبدال الوظيفة الحية أو دمج الجداول دون migration توافقية واختبار OAuth sandbox؛ تم اعتبار هذا انجراف مصدر حرج للتوثيق والإصلاح المنظم.

- Live `meta-oauth-connect`: `/home/ubuntu/.mcp/tool-results/2026-08-17_07-58-08.033019138_supabase_get_edge_function_029b8eb0.json`
- Live `meta-oauth-callback`: `/home/ubuntu/.mcp/tool-results/2026-08-17_07-58-26.839439139_supabase_get_edge_function_28b7cee7.json`
