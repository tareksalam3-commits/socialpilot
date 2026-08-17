# SocialPilot — خريطة الفجوات وأولويات الإصلاح

تاريخ التقييم: 2026-08-17

## المنهج

تمت مقارنة مستودع GitHub المحلي مع مخطط Supabase الحي، ووظائف Edge Functions المنشورة، واستدعاءات الواجهة، ثم صُنفت الفجوات بحسب أثرها على دورة العمل، ومخاطرها الأمنية، وإمكانية اختبارها دون إنشاء منشورات اجتماعية حقيقية.

## مصفوفة الأولويات

| الأولوية | المجال | الدليل الحالي | الأثر | الإجراء المقترح | الحالة |
|---|---|---|---|---|---|
| P0 | Unified Inbox | كانت الشاشة فارغة؛ أضيفت الآن قراءة المحادثات والرسائل والرد عبر Edge Functions | يمنع دورة Listen/Respond | الإبقاء على التغيير، ثم اختبار RLS والرد والتكرار | منفذ، يحتاج اختبارًا حيًا |
| P0 | مخطط Inbox | الجداول حية لكنها لم تكن ممثلة في migrations المحلية | انجراف يمنع إعادة النشر الآمن | إضافة `0017_inbox_and_security_hardening` مع القيود والفهارس وRLS | منفذ ومطبق حيًا |
| P0 | أمان الدوال | Security Definer grants واسعة تاريخيًا، وتوقيعات الدوال مختلفة عن الافتراضات | احتمال توسيع سطح التنفيذ العام | سحب grants غير اللازمة مع الحفاظ على مسارات trigger/server | منفذ جزئيًا، يحتاج إعادة فحص Advisors |
| P0 | مصدر وظائف الإنتاج | ما زالت وظائف حية إضافية غير ممثلة محليًا، خصوصًا الإدارة وبعض عمال الذكاء الاصطناعي والاختبارات | نشر نسخة ناقصة قد يكسر وظائف عاملة | استعادة أو إعادة بناء الوظائف ذات المسار الحرج قبل أي نشر لاحق | جزئي؛ OAuth الحي موثق، وInbox/Scheduler/Account Sync/Automation ممثلة أو موائمة، والإدارة والعمال الإضافيون مفتوحون |
| P1 | Scheduler | `run-scheduler` القديمة غير متوافقة، بينما `scheduler-tick` الحالية متوافقة مع schema بعد الإصلاح | قد تبقى العناصر المجدولة في `queued` دون نشر أو تتكرر | استخدام `scheduler-tick` الحالية مع claim ذري وstale recovery وVault | منفذ ومطبق حيًا؛ اختبار النشر الخارجي مشروط بحساب Sandbox |
| P1 | Account Sync | أُعيد بناء الوظيفة حول `social_accounts` و`social_account_tokens` وربطت بزر مزامنة في MoreScreen | الحسابات تحتاج تحديث حالة الرمز والاسم والمعرّف | فحص المنصات وتحديث `status`, `needs_reconnect`, `metadata`, و`last_sync_at` | منفذ ومطبق حيًا؛ اختبار adapters مشروط بحسابات متصلة |
| P1 | Social OAuth coverage | وظائف Meta/LinkedIn/X/Threads/TikTok الحية منفصلة عن `social-oauth-start` المحلي وتستخدم `oauth_states` و`platform_credentials` | توحيد غير متوافق قد يكسر OAuth أو يسرّب state/token | حفظ المصادر الحية، وعدم استبدالها قبل migration توافقية واختبار Sandbox؛ إصلاح عرض X المنتهي في الواجهة | موثق وآمن؛ التوحيد الكامل واختبار Sandbox مفتوحان |
| P1 | Analytics | زر المزامنة كان يعيد الطلب دون نتيجة مرئية؛ بعد الإصلاح يعرض نجاحًا واضحًا عند عدم وجود Metrics | قد تُعرض لوحة بلا بيانات فعلية أو بمنصات N/A | الحفاظ على اختبارات contract وpartial failure دون اختلاق metrics | منفذ ومختبر فعليًا؛ لا توجد منشورات قابلة لجلب Metrics في الحساب الحالي |
| P1 | Publishing | `social-publish` هو مسار النشر الحالي ويرتبط بـ `publishing_jobs` وScheduler | فشل منصة واحدة قد يترك job في حالة غير متسقة | توحيد idempotency ومنع سباق Publish Now مع Scheduler | منفذ ومطبق حيًا؛ اختبار المنصة مشروط برمز صالح |
| P1 | Automation | `automation-control` القديمة كانت تعتمد schema غير موجود (`connected_accounts`, `posts`, `post_platform_targets`) | كانت ستفشل أو تنحرف عن `publishing_jobs` و`calendar_items` | بناء محول متوافق يحيل النشر إلى `social-publish` الذري ويحافظ على idempotency | نُشرت نسخة متوافقة؛ يلزم اختبار JWT ومسار job فعلي |
| P2 | AI/content | تقرير التنفيذ يوثق Brand Voice وQuality Engine وAI Gateway | مخاطر أقل من النشر والرسائل، لكن يلزم التحقق من cost/status | إضافة اختبارات schema وnon-negative cost وfailure status | منفذ، يحتاج regression tests |
| P2 | Admin/Secrets | `admin-secrets`, `admin-users`, `platform-credentials` حية فقط في أجزاء | صعوبة مراجعة صلاحيات الإدارة وتدفق الأسرار | توثيق endpoints وعدم نقل الأسرار إلى الواجهة، ثم استعادة المصدر | مفتوح |
| P2 | Observability | توجد audit logs وnotifications في المخطط، مع metadata لأخطاء Inbox وAccount Sync | صعوبة تشخيص duplicate webhook أو failed publish | الحفاظ على correlation/idempotency identifiers وإضافة اختبارات failure matrix | جزئي؛ التغطية الموحدة لكل منصة ما زالت مفتوحة |

## ترتيب التنفيذ التالي

بعد Inbox تم توحيد مصدر وظائف التشغيل الحرجة حول `scheduler-tick`, `social-publish`, `account-sync`, و`automation-control` المتوافقة مع schema الحالي. مصادر OAuth الحية محفوظة في `docs/live-edge-functions/` دون استبدالها. الخطوة التالية هي اختبار JWT ومسارات jobs، ثم بناء migration توافقية لـ OAuth واختبارات Sandbox لكل منصة قبل توسيع النشر الخارجي.

## حدود الاختبار

يمكن اختبار RLS وقيود idempotency ورفض الطلبات غير الموثقة داخل Supabase دون نشر اجتماعي حقيقي. أما إثبات النشر والتحليلات وWebhook الفعلي فيتطلب حسابات اجتماعية متصلة ورموز OAuth صالحة وأحداثًا من المنصات؛ لذلك لا يجوز اعتبار عدم توفر تلك الحسابات نجاحًا أو فشلًا للـ adapter نفسه.

## قرار عدم الحذف

لن تُحذف أي Edge Function حية، ولن تُستبدل وظيفة منشورة بنسخة محلية ناقصة، ولن تُحذف فهارس غير مستخدمة قبل وجود بيانات تشغيل كافية. الهدف هو تقليل الانجراف تدريجيًا مع إبقاء وظائف الإنتاج العاملة.

## تحديث التنفيذ — 2026-08-17

| المجال | التغيير المنفذ | التحقق | الحالة الحالية |
|---|---|---|---|
| Scheduler | نُشرت `scheduler-tick` بالإصدار 3 مع claim ذري، stale-job recovery، وقراءة سر Cron من Vault. | طلب بلا سر أعاد 401، والطلب الموثق أعاد 200 مع `checked: 0`، وCron الحي يقرأ السر من `vault.decrypted_secrets`. | منفذ ومختبر دون نشر اجتماعي فعلي |
| Publishing | نُشرت `social-publish` بالإصدار 7 مع إعادة استخدام job الجدولة ومنع السباق بين Publish Now وScheduler. | فحص TypeScript وبناء Vite نجحا؛ يلزم اختبار حساب اجتماعي تجريبي/رمز صالح لإثبات النشر الخارجي. | منفذ، اختبار المنصة مشروط بحساب متصل |
| Account Sync | أُعيد بناء `account-sync` بالإصدار 6 ليتوافق مع `social_accounts` و`social_account_tokens`، ويدعم Facebook/Instagram/X/LinkedIn/Threads/TikTok/Telegram/WhatsApp، ويحدث `status`, `needs_reconnect`, `metadata`, `last_sync_at`. | الطلب غير الموثق أعاد 401، والطلب بـ JWT غير صالح أعاد 401؛ أضيف زر فحص حقيقي في MoreScreen، ونجح TypeScript/Vite. | منفذ، يحتاج جلسة مستخدم وحسابات اجتماعية لاختبار platform adapters |

تم اختبار Analytics Sync فعليًا في الإنتاج بعد نشر إصلاح UX؛ أعادت المزامنة نجاحًا واضحًا مع عدم وجود منشورات منشورة قابلة لجلب Metrics. استُعيدت مصادر OAuth الحية لعشر وظائف وحُفظت في `docs/live-edge-functions/`، ونُشرت `automation-control` المتوافقة مع schema الحالي. كما أُصلح عرض حساب X المنتهي بحيث يعرض «ربط» بدل «إزالة»، وأضيفت إعادة كتابة Vercel مع mapping لمسارات `/app/*`. ما يزال اختبار OAuth والنشر والتحليلات الخارجية مشروطًا بحسابات Sandbox ورموز صالحة، كما أن وظائف الإدارة والعمال الإضافيين تحتاج استعادة أو مراجعة لاحقة.
