# SocialPilot Architecture Audit

تاريخ التدقيق: 2026-08-17

## نطاق الفحص الأولي

تم فحص مستودع GitHub `tareksalammohamed/socialpilot` محليًا، وحالة GitHub الحالية، وملفات React/Vite، وطبقة API، ومخطط migrations المحلي، ثم تمت مقارنة ذلك بمشروع Supabase `iqbuedqugkpxqdrzhfzn`.

## نتائج الاستكشاف الأولية

| المجال | الملاحظة | الأثر |
|---|---|---|
| الواجهة | المشروع Vite + React + TypeScript، والواجهة مقسمة إلى Home/Create/Content/Analytics/Inbox/More | بنية قابلة للتوسعة، لكنها لا تعني أن كل المسارات متصلة بخلفية حقيقية |
| Inbox | `src/screens/InboxScreen.tsx` يعرض EmptyState فقط ولا يقرأ `inbox_conversations` أو `inbox_messages` | الرسائل والتعليقات ليست End-to-End من واجهة المستخدم حاليًا |
| API | `src/lib/api.ts` يعرّف مسارات AI وOAuth وTelegram والنشر، ولا توجد طبقة API ظاهرة لمسارات Inbox/Comments/Analytics sync | فجوة بين متطلبات Unified Inbox وبين نقاط الاستخدام في الواجهة |
| المخطط المحلي | توجد الجداول الأساسية للمحتوى والجودة والجدولة والنشر، إضافة إلى `post_insights` و`inbox_conversations` و`inbox_messages` في migrations لاحقة/حالة Supabase | توجد نواة جيدة، لكن يجب التحقق من التدفق والـ RLS والوظائف المرتبطة |
| قاعدة البيانات الحية | Supabase يحتوي على `inbox_conversations` و`inbox_messages`، ولا يظهر جدول مستقل باسم `comments` أو `messages` | ينبغي اعتماد نموذج Inbox الموحد إن كان يغطي التعليقات، أو إضافة طبقة ربط واضحة دون إنشاء Architecture مكررة |
| انجراف المخطط | Supabase يحتوي على migrations إضافية بعد `0016`، منها `0017` و`0018_inbox_schema` و`0019_inbox_realtime`، بينما المستودع المحلي يحتوي حتى `0016` فقط | المستودع لا يمثل كامل الحالة المنشورة؛ يجب توثيق/مزامنة migrations قبل أي تعديل DDL |
| الوظائف المنشورة | Supabase ينشر وظائف عديدة غير موجودة في `supabase/functions` المحلي، منها `inbox-webhook`, `inbox-reply`, `account-sync`, `run-scheduler`, `social-publish`, `analytics-sync` وغيرها | يوجد انجراف كبير بين الكود المنشور والكود المصدر؛ لا يجوز افتراض أن تعديل المحلي يحدّث الوظيفة الحية دون استعادة المصدر أو إعادة بنائه بعناية |
| التكاملات | الوظائف الحية تغطي Meta وLinkedIn وX وThreads وTikTok وTelegram وWhatsApp، بينما المصدر المحلي يحتوي عددًا أقل من وظائف OAuth | يلزم تدقيق منصة-بمنصة، وتحديد ما هو مكتوب محليًا مقابل ما هو منشور فقط |
| بيانات العينة | توجد سجلات فعلية قليلة في المشروع الحي: Workspace واحد، 4 حسابات اجتماعية، 3 variants، 3 quality reviews، 3 publishing jobs، ولا توجد post insights أو inbox records | توجد بيانات تشغيل/اختبار فعلية، لكن لا تكفي لإثبات المسارات الحية للرسائل والتحليلات |
| الحالة المنشورة | كل الوظائف الظاهرة في جرد Supabase حالتها `ACTIVE`، مع اختلاف `verify_jwt` حسب وظيفة OAuth/Webhook/Scheduler | يجب فحص صلاحيات كل endpoint وعدم تغيير الوظائف العامة دون تحقق من توقيع webhook أو المصادقة المناسبة |

## الاستنتاج المرحلي

المشروع ليس بحاجة إلى إعادة بناء من الصفر. توجد نواة Content/Quality/Calendar/Publishing/Analytics وSupabase يعمل، لكن **Inbox/Comments/Messages هو أكبر فجوة واضحة في الواجهة**، كما أن **انجراف الكود المحلي عن migrations وEdge Functions المنشورة** يمثل خطرًا معماريًا قبل تنفيذ إصلاحات جديدة. المرحلة التالية ستتحقق من الجداول والسياسات والوظائف وسجلات التشغيل، ثم تُنشئ خريطة فجوات قابلة للتنفيذ.

## نتائج Supabase الأمنية والأدائية

فحص Supabase Security Advisors أظهر أن جداول الأسرار (`ai_provider_secrets`, `social_account_tokens`, `social_oauth_states`, `social_platform_app_secrets`, و`system_settings`) مفعّل عليها RLS دون سياسات، وهو قد يكون مقصودًا إذا كان الوصول محصورًا في service role، لكنه يحتاج إلى توثيق واختبار بأن أدوار `anon` و`authenticated` لا تستطيع القراءة أو الكتابة. كما أظهر الفحص دوال `SECURITY DEFINER` قابلة للتنفيذ من `anon` أو `authenticated`، منها `am_i_platform_admin`, `is_super_admin`, `handle_new_user_workspace`, `create_workspace_with_owner`, `touch_inbox_conversation`, و`user_workspace_role`. هذه ليست مجرد ملاحظات شكلية؛ يجب تضييق صلاحيات `EXECUTE` على الدوال التي لا تحتاجها الواجهة العامة، مع الحفاظ على المسارات التي يعتمد عليها تسجيل الدخول وإنشاء مساحة العمل.

فحص Performance Advisors أظهر فهارس مفقودة على مفاتيح خارجية في `inbox_conversations.content_id` و`inbox_messages.user_id`. كما أظهر عدة فهارس غير مستخدمة، ومنها فهارس Inbox و`post_insights` و`ai_runs` و`notifications`. لا ينبغي حذف الفهارس غير المستخدمة مباشرةً قبل وجود بيانات تشغيل كافية؛ الأولوية الحالية هي إضافة فهارس المفاتيح الخارجية المطلوبة وتحسين استعلامات Inbox الفعلية.

## ملاحظة انجراف التشغيل

قائمة Supabase الحية تحتوي على وظائف كثيرة غير موجودة في المصدر المحلي، بما في ذلك وظائف Inbox وScheduler وOAuth لمنصات إضافية. لذلك يجب قبل نشر أي Edge Function لاحقًا تحديد مصدر الحقيقة لكل وظيفة: إما استعادة المصدر الحي إلى GitHub، أو إعادة بناء الوظيفة محليًا من العقد الحالي مع اختبارها، ثم نشرها فقط بعد التحقق. لا يجوز نشر نسخة محلية ناقصة فوق وظيفة حية تعمل حاليًا.

## مصادر Supabase

[1]: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
[2]: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
[3]: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
[4]: https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys
[5]: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index


## نتائج المرحلة الثانية: Inbox وRLS والدوال

| الفحص | النتيجة | القرار التنفيذي |
|---|---|---|
| `inbox_conversations` | الجدول الحي موجود، أعمدته تشمل `account_id`, `platform`, `type`, `external_id`, `unread`, `content_id`, و`metadata`، ولا يحتوي سجلات حاليًا | اعتماد الجدول كنموذج موحد للمحادثات المباشرة والتعليقات بدل إنشاء جداول مكررة |
| `inbox_messages` | الجدول الحي موجود، ويدعم inbound/outbound و`external_id` و`user_id` و`metadata`، ولا يحتوي سجلات حاليًا | ربط الواجهة به مباشرة مع Edge Function للرد الخارجي |
| idempotency | الوظيفة الحية تستخدم تعارضات `account_id,platform,type,external_id` للمحادثة و`conversation_id,external_id` للرسالة | أضيفت فهارس unique محلية وحية لمنع تكرار Webhook ورسائل المنصات |
| RLS | المحادثات تسمح للعضو بالقراءة والتحديث، والرسائل تسمح بالقراءة فقط؛ الكتابة الخلفية تتم عبر service role | الإبقاء على نموذج أقل صلاحية وعدم فتح إدخال الرسائل من الواجهة |
| الوظائف الحية | `inbox-webhook` يعالج Meta/WhatsApp ويتحقق من توقيع HMAC، و`inbox-reply` يتحقق من جلسة المستخدم ويرسل عبر Meta/LinkedIn/WhatsApp/Telegram | استُعيد المصدر الحي إلى `supabase/functions` المحلي للمراجعة والنشر المنضبط |
| Advisors | كان هناك نقص فهارس على `content_id` و`user_id` مع فهارس Inbox تشغيلية غير موجودة في المصدر المحلي | أضيفت الفهارس المطلوبة، مع عدم حذف الفهارس غير المستخدمة قبل توفر بيانات تشغيل كافية |
| EXECUTE grants | وُجدت منح غير لازمة لـ`anon` أو `PUBLIC` على دوال Security Definer، مع اختلاف توقيعات الدوال عن الافتراض الأولي | صُححت migration لتستخدم التوقيعات الفعلية وسُحبت المنح غير اللازمة |

## ما تم تنفيذه

1. استُبدلت شاشة Inbox الفارغة بتدفق حقيقي يحمّل المحادثات والرسائل من Supabase، يعلّم المحادثة كمقروءة، ويعرض حالات التحميل والفشل.
2. أضيفت طبقة API typed لإجراءات `listInboxConversations`, `listInboxMessages`, `markInboxConversationRead`, و`sendInboxReply`.
3. استُعيدت وظيفتا `inbox-webhook` و`inbox-reply` من الحالة المنشورة إلى المصدر المحلي.
4. أضيفت migration `20260817080000_0017_inbox_and_security_hardening.sql` وطُبقت بنجاح على مشروع Supabase `iqbuedqugkpxqdrzhfzn` بعد تصحيح توقيعات الدوال.
5. نجح `tsc --noEmit` وبناء Vite مباشرةً، بينما فحص `pnpm` التلقائي توقف بسبب سياسة اعتماد `esbuild` التي تتطلب `pnpm approve-builds`؛ هذه مشكلة بيئية في مدير الحزم وليست خطأ TypeScript أو Vite.

## المخاطر المتبقية

لا توجد سجلات Inbox حية يمكن استخدامها لاختبار Webhook من طرف إلى طرف دون بيانات اعتماد المنصات أو حدث حقيقي. كما أن وظائف Scheduler وAccount Sync وبعض مصادر OAuth ما زالت منشورة فقط أو غير ممثلة بالكامل في المستودع المحلي، ولذلك ستُعالج في خريطة الفجوات التالية بدل نشر نسخ ناقصة فوقها.

## اختبارات ما بعد الإصلاح — 2026-08-17

| الاختبار | النتيجة | الملاحظات |
|---|---|---|
| `npm run lint` | ناجح | لا توجد أخطاء أو تحذيرات بعد إصلاح استيراد account-sync وReact Hook في Inbox. |
| `npm run typecheck` | ناجح | TypeScript يمر على `tsconfig.app.json`. |
| `npm run build` | ناجح | Vite أنتج حزمة إنتاج بحجم JavaScript مضغوط يقارب 135.6 kB. |
| `git diff --check` | ناجح | لا توجد مسافات زائدة أو أخطاء تنسيق في الفروقات. |
| `account-sync` دون Authorization | 401 | تم رفض الطلب قبل الوصول إلى بيانات الحسابات. |
| `account-sync` مع JWT غير صالح | 401 | تم رفض صيغة JWT غير الصالحة. |
| `inbox-reply` دون Authorization | 401 | لم يتم تنفيذ أي رد خارجي. |
| `scheduler-tick` دون Authorization | 401 | لم يتم تشغيل دورة النشر. |
| `inbox-webhook` دون توقيع | 401 | تم رفض Webhook ذي التوقيع المفقود. |
| Scheduler Cron | ناجح | الجدولة كل دقيقة، والـ command يقرأ السر من `vault.decrypted_secrets` بدل تضمينه نصيًا. |
| Supabase migrations | ناجح | migrations `inbox_and_security_hardening`, `scheduler_security`, و`drop_duplicate_inbox_index` مسجلة حيًا. |
| Supabase performance advisors | تحسن | اختفى تحذير الفهرس المكرر؛ بقيت تنبيهات INFO عن فهارس غير مستخدمة، وهي ليست أخطاء تشغيلية. |

## حدود الاختبار

لم يُنفذ نشر خارجي فعلي على منصة اجتماعية ولم تُرسل رسالة حقيقية لأن البيئة الحالية لا تحتوي جلسة مستخدم اختبارية وحسابات اجتماعية متصلة برموز صالحة. لذلك اقتصر الاختبار الخارجي على مسارات المصادقة والرفض، والبناء، وعقد الوظائف، وفحص Supabase الحي. يلزم اختبار قبول يدوي بحساب Sandbox لكل منصة قبل اعتماد النشر الإنتاجي الكامل.

## تنبيهات متبقية

يعرض Supabase تحذيرات `SECURITY DEFINER` لبعض RPCs؛ بعضها مستخدم فعليًا من Auth/Workspace/RLS، ولذلك لم تُسحب صلاحياته عشوائيًا حتى لا ينكسر التسجيل أو عزل مساحة العمل. كما يعرض Supabase INFO عن فهارس غير مستخدمة، ولا يُنصح بحذفها قبل وجود workload حقيقي أو قياس `pg_stat_user_indexes` عبر فترة تشغيل كافية. وتظل حماية كلمات المرور المسرّبة في Auth بحاجة إلى تفعيل من إعدادات Supabase Auth.

## بوابة الإصدار النهائية

| البند | القرار |
|---|---|
| مصدر الكود | تم دفع الإصلاحات إلى [`tareksalammohamed/socialpilot`](https://github.com/tareksalammohamed/socialpilot) على `main` في commit `d2c77d8`. |
| Inbox | قابل للمراجعة وإعادة النشر من GitHub، مع قراءة/تعليم كمقروء/رد، Webhook، idempotency، وRLS. |
| Scheduler | `scheduler-tick` هو المسار المعتمد؛ `run-scheduler` القديمة بقيت غير مستخدمة لأنها تعتمد على schema legacy. |
| Account Sync | مصدر محلي وحَيّ متوافق مع `social_accounts` و`social_account_tokens` ومربوط بواجهة الحسابات. |
| الأسرار | سر Cron موجود في Supabase Vault، ولا يظهر في أمر pg_cron أو ملفات المصدر. |
| البناء | `lint`, `typecheck`, `build`, و`git diff --check` ناجحة. |
| اختبار المنصات | مؤجل لاختبار قبول بحسابات Sandbox ورموز OAuth صالحة؛ لم تُرسل منشورات أو ردود خارجية في هذا التدقيق. |
| قرار النشر | التغييرات الحالية قابلة للدمج، مع إبقاء وظائف OAuth والإدارة والتحليلات غير المستعادة خارج نطاق الاستبدال حتى يتوفر مصدرها أو عقدها الموثق. |

### الخلاصة

أصبحت المسارات الحرجة **Inbox → Reply**, **Schedule → Publish**, و**Account Sync** ممثلة في GitHub ومتصلة بالبنية الحالية لـ Supabase. ما تبقى ليس فشلًا مخفيًا في هذه المسارات، بل فجوات مصدر حقيقة واختبارات قبول خارجية تحتاج بيانات اعتماد المنصات وبيئة Sandbox. لا ينبغي اعتبار الاختبارات الحالية إثباتًا للنشر الاجتماعي الفعلي قبل تنفيذ اختبار قبول خارجي مضبوط.


## مراجعة الأمن النهائية — 2026-08-17

أُعيد فحص Supabase الحي بعد نشر migrations `revoke_public_rpc_exec` و`harden_security_definer_helpers`. الجداول التشغيلية الأساسية مثل `workspaces`, `workspace_members`, `social_accounts`, `publishing_jobs`, `calendar_items`, `content`, `content_variants`, `inbox_conversations`, `inbox_messages`, `post_insights`, `notifications`, و`audit_logs` مفعّل عليها RLS، وسياسات القراءة والكتابة تعتمد على `user_workspace_role(workspace_id)` أو على دور `owner/admin` في العمليات الحساسة. لا تستخدم واجهة المستخدم جدول `social_account_tokens`، ولا توجد له سياسات قراءة للمستخدمين؛ كما لا توجد سياسات خارجية على جداول الأسرار وحالات OAuth (`ai_provider_secrets`, `social_platform_app_secrets`, `social_oauth_states`, و`platform_admins`). هذه الجداول تُعامل كمخازن خادم/خاصة، وليس كمصدر بيانات للواجهة.

| مجال التحقق | النتيجة الفعلية | القرار |
|---|---|---|
| RLS وعزل Workspace | السياسات الحية تربط الصفوف بعضوية workspace، مع تقييد الحذف وعمليات insights/accounts على owner/admin حيث يلزم | مقبول للمسارات الحالية؛ لا توجد قراءة عابرة لمساحات العمل في الاختبار المنفذ |
| RPCs الخاصة بالجدولة | `approve_content_variant`, `reschedule_calendar_item`, و`schedule_content_variant` أصبحت قابلة للتنفيذ من `authenticated` فقط، بعد إزالة `PUBLIC/anon` | تم الإصلاح في migration `0020_revoke_public_rpc_exec` |
| وظائف trigger الداخلية | أُزيل execute عن `handle_new_user_workspace`, `touch_inbox_conversation`, و`am_i_platform_admin` من الأدوار الخارجية؛ بقي استخدامها داخل قاعدة البيانات أو لم يعد مكشوفًا كـ RPC | تم الإصلاح في migration `0021_harden_security_definer_helpers` |
| `is_super_admin` | بقيت `SECURITY DEFINER` لأنها تقرأ جدول `platform_admins` الخاص، لكن أصبحت تُرجع true فقط عندما يطابق `check_uid` هوية JWT الحالية | تم تقليل خطر probing مع الحفاظ على عقد `ai-admin` و`social-platform-admin` |
| Supabase Security Advisor | اختفت تحذيرات الدوال trigger-only؛ بقيت تحذيرات WARN المقصودة لـ `create_workspace_with_owner`, `is_super_admin`, و`user_workspace_role` لأن الأولى تنشئ workspace عبر definer، والثانية والثالثة لازمتان للإدارة وRLS. بقي تحذير حماية كلمات المرور المسرّبة معطّلًا | يلزم تفعيل Leaked Password Protection من إعدادات Auth قبل اعتماد أمني كامل [1] |
| Supabase Performance Advisor | بقيت INFO عن فهارس غير مستخدمة، منها فهارس `content`, `post_insights`, `social_oauth_states`, و`inbox_messages` | لا تُحذف قبل قياس workload حقيقي؛ التنبيهات ليست فشلًا وظيفيًا [2] |

> **حدود النتيجة:** وجود RLS مفعّل لا يثبت وحده أن كل تكامل خارجي نجح؛ اختبار النشر والرد الفعليين يتطلب حسابات Sandbox ورموز OAuth صالحة لكل منصة. كما أن تحذيرات `SECURITY DEFINER` المتبقية موثقة كقرارات تصميم مقصودة وليست مُخفاة.

### References

[1]: https://supabase.com/docs/guides/auth/password-security "Supabase Auth password security"
[2]: https://supabase.com/docs/guides/database/database-linter "Supabase database advisors and linter"
