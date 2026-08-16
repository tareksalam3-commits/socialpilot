# تقرير تنفيذ SocialPilot — المرحلة الثانية وما بعدها

تم فحص المشروع المرفق كما هو، والبناء على تنفيذ المرحلة الأولى دون إعادة بنائه. نُفذت التغييرات على الواجهة، وظائف Supabase Edge Functions، ومخطط قاعدة البيانات، ثم طُبقت migrations الجديدة على مشروع Supabase الخاص بـ **SocialPilot** (`iqbuedqugkpxqdrzhfzn`).

## ملخص التنفيذ

| المسار | ما تم تنفيذه | الحالة |
|---|---|---|
| جودة البوست الواحد | إضافة بطاقة جودة تعرض الحكم، الدرجة، المشكلات الرئيسية، والتحسينات المقترحة | مكتمل |
| Brand Voice / Brand Brain | إضافة حقول صريحة للتموضع والعبارات المفضلة والممنوعة وأسلوب CTA، وحفظها وعرضها وإدخالها في prompts | مكتمل |
| حلقة الأداء | تمرير performance إلى محلل الأداء مع إلزامه بتحويل الأرقام إلى قرارات في الموضوع والمنصة والتوقيت وCTA | مكتمل |
| التحليلات | إضافة Today/7/30/90/Custom، أفضل وأسوأ منشور، أفضل منصة، أفضل نوع محتوى، أفضل وقت نشر، واتجاه التفاعلات | مكتمل |
| التقويم | إظهار عنوان ونص المحتوى المرتبط، وإضافة تعديل الموعد عبر RPC آمن يحدّث calendar item والمحتوى ومهمة النشر دون duplicate job | مكتمل |
| النشر | إضافة retry bounded للنشر، معالجة race condition في idempotency، وتمييز الحسابات ذات التوكن المنتهي | مكتمل |
| مزامنة التحليلات | إضافة retry bounded، وإرجاع المنصات غير المدعومة صراحةً مع الحفاظ على البيانات السابقة | مكتمل |
| قاعدة البيانات | تطبيق migrations `0011_brand_voice_fields` و`0012_reschedule_calendar_item` على Supabase | مكتمل |
| النشر السحابي | نشر `ai-gateway` الإصدار 24، و`social-publish` الإصدار 4، و`analytics-sync` الإصدار 2 | مكتمل |

## الملفات الرئيسية المعدلة

تم تعديل الملفات التالية داخل المشروع:

| الملف | التغيير |
|---|---|
| `src/screens/CreateScreen.tsx` | إضافة Quality UI لمسار المحتوى الواحد |
| `src/screens/BrandBrainOnboarding.tsx` | حفظ وعرض حقول Brand Voice الجديدة |
| `src/screens/AnalyticsScreen.tsx` | توسيع لوحة التحليلات والفلاتر والتصنيفات والاتجاه الزمني |
| `src/screens/ContentScreen.tsx` | إضافة rescheduling، عرض المحتوى داخل التقويم، وربط النشر بالـ calendar item ومعالجة أخطاء التحميل |
| `src/lib/types.ts` | تحديث عقود Brand DNA والنتائج المولدة |
| `supabase/functions/ai-gateway/index.ts` | إدخال Brand Voice وperformance في القرار الفعلي للنماذج |
| `supabase/functions/social-publish/index.ts` | retry، idempotency تحت التزامن، وتحديث حالة الحساب عند انتهاء التوكن |
| `supabase/functions/analytics-sync/index.ts` | retry وإرجاع المنصات التي لا تملك مسار metrics منفذًا |
| `supabase/migrations/20260816150000_0011_brand_voice_fields.sql` | حقول Brand Voice وRLS متوافق مع النمط القائم |
| `supabase/migrations/20260816151000_0012_reschedule_calendar_item.sql` | RPC آمن لإعادة الجدولة وتحديث مهام النشر المرتبطة |

## قرار تكامل المنصات

النشر الفعلي في الكود موجود حاليًا لـ **Telegram وX وFacebook وInstagram وLinkedIn**، لكن نجاح كل منصة ما زال مشروطًا بصحة OAuth scopes، بيانات الحساب، وصلاحيات المنصة. لا يتم وضع job في حالة نجاح عند غياب هذه المتطلبات. أما مزامنة التحليلات، فالمسار المنفذ فعليًا هو **X**؛ المنصات الأخرى، بما فيها Telegram، تبقى `N/A` بدل اختلاق أرقام، وتُحفظ snapshots القديمة عند فشل المزامنة.

## الأمان وقاعدة البيانات

الـ migrations الجديدة لا تضيف جدولًا عامًا بلا حماية. حقول Brand Voice أضيفت إلى `brand_dna` الموجودة أصلًا مع إعادة تأكيد سياسات RLS المبنية على `user_workspace_role(workspace_id)`. أما RPC إعادة الجدولة فهي `SECURITY INVOKER` وتتحقق من عضوية المستخدم، ملكية عنصر التقويم، وحالات العناصر غير القابلة لإعادة الجدولة.

أظهر فحص Supabase بعض تنبيهات أمنية قديمة في جداول أسرار النظام ودوال `SECURITY DEFINER` الموجودة قبل هذه المهمة. لم تُعدّل هذه الأجزاء غير المرتبطة لأن بعضها مستخدم في مسارات النظام الحالية، لكن يجب مراجعتها لاحقًا كمسار أمني مستقل. كما ظهرت تنبيهات أداء `INFO` عن فهارس قديمة غير مستخدمة؛ لا توجد منها أخطاء فشل أو تنبيهات ناتجة عن migration الجديدة نفسها.

## الاختبارات المنفذة

| الاختبار | النتيجة |
|---|---|
| `npm run lint` | ناجح؛ ظهر تحذير توافق TypeScript من أداة lint دون أخطاء |
| `npm run typecheck` | ناجح |
| `npm run build` | ناجح؛ تم إنتاج Vite production bundle |
| تطبيق migration `0011` على Supabase | ناجح |
| تطبيق migration `0012` على Supabase | ناجح |
| التحقق من migration history | migrationان مسجلان عن بُعد |
| نشر Edge Functions | الوظائف الثلاث في حالة `ACTIVE` مع `verify_jwt: true` |
| فحص Supabase security advisors | لا توجد مشكلة ناتجة عن الحقول أو RPC الجديدة؛ توجد تنبيهات تاريخية موضحة أعلاه |

## ملاحظات تشغيلية

المشروع المرفق هو Vite frontend مستقل، ولذلك تم تسليم build محلي ناجح ونشر وظائف Supabase فقط عبر المشروع المتصل. لا توجد في الطلب معلومات كافية لنشر واجهة Vite على استضافة بعينها. كما أن سيناريوهات النشر الحقيقية للمنصات الاجتماعية تحتاج حسابات متصلة وصلاحيات OAuth فعلية حتى يمكن اختبار API الخارجي end-to-end، لذلك اقتصر الاختبار الآلي هنا على التحقق البنيوي، typecheck، lint، build، migrations، ونشر الوظائف.

### مراجع تنبيهات Supabase

[1]: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy — RLS Enabled No Policy
[2]: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable — Public Can Execute SECURITY DEFINER Function
[3]: https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index — Unused Index


# ملحق — توسيع تحليلات Facebook وInstagram

تم تنفيذ أول توسعة فعلية لمزامنة التحليلات خارج X، وشملت Facebook وInstagram عبر Adapters داخل `supabase/functions/analytics-sync/index.ts`.

| المسار | ما تم إضافته |
|---|---|
| Facebook | قراءة بيانات المنشور الأساسية والتفاعلات والمشاركات، ومحاولة قراءة `post_clicks` اختياريًا مع عدم فشل باقي metrics عند عدم توفره |
| Instagram | قراءة `comments`, `likes`, `reach`, `saved`, `shares`, `total_interactions`, و`views` لكل Media ID، مع تسجيل الأخطاء لكل metric بدل إيقاف الدفعة |
| OAuth | إضافة `read_insights` و`instagram_manage_insights` إلى Meta scopes الافتراضية وتحديث Graph API إلى إصدار قابل للضبط، افتراضيًا `v26.0` |
| Token handling | التحقق من انتهاء Meta token وتحديث الحساب إلى `expired` و`needs_reconnect` بدل تسجيل مزامنة ناجحة كاذبة |
| Partial success | إرجاع `errors` و`unsupportedPlatforms`، وعرضها للمستخدم في Analytics مع الحفاظ على snapshots القديمة |
| Dashboard | إضافة تسميات metrics الجديدة وإدخال reactions وsaved وtotal_interactions ضمن حساب التفاعل |
| قاعدة البيانات | تطبيق migration `20260816153000_0013_meta_insights_scopes` لتحديث إعداد Meta الحالي عند إعادة الربط |

تم نشر `analytics-sync` بالإصدار 3، و`social-oauth-start` بالإصدار 4، و`social-oauth-callback` بالإصدار 4، وكلها في حالة `ACTIVE` مع `verify_jwt: true`. كما تم التحقق من رفض الوظائف للطلبات غير الموثقة برمز HTTP 401.

لا يمكن تنفيذ اختبار API حقيقي على صفحة Facebook أو حساب Instagram من دون جلسة OAuth وحساب Meta متصل فعليًا. بعد إعادة ربط Meta من داخل التطبيق، يجب الضغط على «مزامنة» في Analytics للتحقق من وصول أول snapshots. وفق وثائق Meta الحالية، Page Insights تتطلب Page access token وصلاحيات `read_insights` و`pages_read_engagement`، بينما Instagram Media Insights تتطلب حسابًا احترافيًا وصلاحيات Insights المناسبة.[4] [5]

[4]: https://developers.facebook.com/docs/graph-api/reference/insights/ — Meta Page Insights API
[5]: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights — Meta Instagram Media Insights API


# ملحق — الاختبار الحي والإصلاحات اللاحقة

تم تسجيل الدخول واختبار التطبيق المنشور بحساب المستخدم العادي `tarek.salam3@gmail.com` وبحساب السوبر أدمن `tiano.salam@gmail.com`. تم اختبار لوحة المستخدم، إنشاء المحتوى، نتيجة الجودة، حفظ المحتوى، شاشة المحتوى، التقويم، إعادة الجدولة، Analytics، الرسائل، Brand DNA، الحسابات المتصلة، AI Usage، وإعدادات AI Control Center.

| الاختبار الحي | النتيجة |
|---|---|
| دخول المستخدم العادي | ناجح، وظهرت مساحة العمل والحسابات المتصلة |
| دخول السوبر أدمن | ناجح، وظهر AI Control Center مع صلاحيات الإدارة |
| AI Usage | تم اكتشاف تكلفة سالبة تاريخية وإصلاحها؛ أصبحت لوحة المستخدم والسوبر أدمن تعرض `$0.000` |
| إنشاء محتوى بالذكاء الاصطناعي | ناجح؛ ظهر منشور تأمين بثلاث نسخ وQuality Score قدره 85/100 |
| حفظ المحتوى | ناجح؛ ظهر المنشور كمسودة في شاشة المحتوى |
| إنشاء خطة محتوى | ناجح؛ ظهرت خطة بفترة واحدة وQuality Score قدره 87/100 |
| حفظ الخطة والتقويم | تم اكتشاف خلل في PostgREST upsert الجزئي وإصلاحه عبر migration `0015` وRPC `0016`؛ أصبح العنصر يظهر في التقويم |
| إعادة الجدولة | ناجحة؛ ظهرت رسالة تحديث الموعد ومهمة النشر دون إنشاء مهمة مكررة |
| Analytics والمزامنة | الواجهة والفلاتر والمزامنة تعمل؛ لا توجد Insights لأن الاختبار لم يستخدم منشورًا منشورًا بحساب اجتماعي حقيقي |
| AI Control Center وتحديث المزودين | ناجح، مع بقاء حالات المزودين والكتالوج دون أخطاء مرئية |

تم تطبيق migration `0014_nonnegative_ai_costs` لتصفير بيانات التكلفة السالبة وإضافة قيود عدم السلبية، وmigration `0015_calendar_variant_upsert` لإضافة unique index كامل يدعم PostgREST upsert، وmigration `0016_schedule_content_variant` لإضافة RPC ذرية وآمنة لحفظ المواعيد وتحديث المحتوى والنسخة.

تم نشر `ai-gateway` بالإصدار 25 و`ai-admin` بالإصدار 3 بعد إصلاح التكلفة ومسار dependency، ثم نُشر build الواجهة عبر Vercel بعد commit `c692f94`. كما نجحت اختبارات `npm run lint` و`npm run typecheck` و`npm run build`.

أُنشئت سجلات اختبار داخل مساحة العمل، منها مسودة ومنشورات مجدولة لاختبار دورة المحتوى والتقويم. هذه سجلات اختبار فعلية وليست بيانات وهمية داخل الكود، ويمكن حذفها يدويًا من شاشة المحتوى إذا لم تعد مطلوبة. أما النشر والتحليلات الحقيقية للمنصات، فما زالا يتطلبان OAuth فعليًا وحسابات اجتماعية مرتبطة وصلاحيات API مناسبة.

# ملحق — إصلاح نشر LinkedIn وتدقيق إصدارات المنصات

تم تحليل رسالة الخطأ الظاهرة في شاشة LinkedIn: `Illegal version 2.0 specified`. السبب كان إرسال ترويسة Restli بقيمة `2.0`، بينما تتطلب LinkedIn القيمة الدقيقة `2.0.0`. كما أن مسار UGC القديم تم استبداله بمسار Posts API الحديث `POST /rest/posts`، مع `Linkedin-Version` قابل للضبط وقيمة افتراضية `202607`، وبنية طلب النص العضوي الرسمية.

| المنصة | الإصلاح |
|---|---|
| LinkedIn | الانتقال إلى `/rest/posts`، تصحيح Restli إلى `2.0.0`، إضافة LinkedIn API version `202607`، وتحسين رسالة الصلاحيات عند الفشل |
| Facebook | إزالة `v20.0` الثابت واستخدام `META_GRAPH_VERSION` الافتراضي `v26.0` |
| Instagram | توحيد Graph API على `META_GRAPH_VERSION` الافتراضي `v26.0` لمساري إنشاء ونشر الوسائط |
| X وTelegram | توحيد استخراج رسائل الخطأ التفصيلية بدل إخفائها خلف رسالة عامة |

تم نشر `social-publish` إلى Supabase بالإصدار 6، وحالته `ACTIVE` مع `verify_jwt: true`. كما نجحت `npm run lint` و`npm run typecheck` و`npm run build`، ورفع الإصلاح إلى GitHub في commit `de6a606`.

لم يتم الضغط على «نشر الآن» أثناء التحقق النهائي لأن ذلك ينشئ منشورًا حقيقيًا على حساب اجتماعي مربوط. يلزم بعد إعادة تحميل التطبيق الضغط على «نشر الآن» لنسخة LinkedIn مرة واحدة فقط للتحقق من OAuth والصلاحية `w_member_social` فعليًا.
