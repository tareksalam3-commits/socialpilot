# OAuth Live Source Audit

هذا المجلد يحتفظ بنسخ خام من مصادر وظائف OAuth المستعادة من مشروع Supabase الحي `iqbuedqugkpxqdrzhfzn` بتاريخ التدقيق. هذه الملفات مرجعية فقط؛ لم تُنشر منها أي نسخة فوق الوظائف الحالية.

> الغرض من الحفظ هو منع فقدان عقد OAuth الحي أثناء توحيد المعمارية. لا تحتوي الوثيقة على access tokens أو client secrets؛ الحقول الحساسة التي قد تظهر في الكود هي أسماء متغيرات أو مفاتيح جداول فقط.

| الوظيفة | الإصدار الحي | الحالة | JWT | ملف المصدر المرجعي |
|---|---:|---|---|---|
| `linkedin-oauth-callback` | 6 | ACTIVE | false | `linkedin-oauth-callback.live.json` |
| `linkedin-oauth-connect` | 5 | ACTIVE | false | `linkedin-oauth-connect.live.json` |
| `meta-oauth-callback` | 7 | ACTIVE | false | `meta-oauth-callback.live.json` |
| `meta-oauth-connect` | 7 | ACTIVE | true | `meta-oauth-connect.live.json` |
| `threads-oauth-callback` | 5 | ACTIVE | false | `threads-oauth-callback.live.json` |
| `threads-oauth-connect` | 4 | ACTIVE | true | `threads-oauth-connect.live.json` |
| `tiktok-oauth-callback` | 5 | ACTIVE | false | `tiktok-oauth-callback.live.json` |
| `tiktok-oauth-connect` | 5 | ACTIVE | true | `tiktok-oauth-connect.live.json` |
| `x-oauth-callback` | 4 | ACTIVE | false | `x-oauth-callback.live.json` |
| `x-oauth-connect` | 4 | ACTIVE | true | `x-oauth-connect.live.json` |

## Contract findings

المسار الحي الجديد لمنصات Meta وLinkedIn وX وThreads وTikTok منفصل عن المسار المحلي العام `social-oauth-start`/`social-oauth-callback`. المسار الحي يبدأ من وظائف منصة مخصصة ويستخدم جداول `oauth_states` و`oauth_pending_selections` و`platform_credentials`، بينما المسار المحلي العام يستخدم `social_oauth_states` و`social_platform_apps` و`social_platform_app_secrets` ويحفظ الحسابات مباشرة في `social_accounts`.

هذا الاختلاف ليس اختلاف تسمية فقط؛ فهو يغيّر مكان إعداد credentials، طريقة اختيار حساب Meta، عنوان redirect، وقواعد callback. لذلك القرار الآمن هو إبقاء الوظائف الحية كما هي، حفظ مصادرها في GitHub، وعدم نشر نسخة محلية إلا بعد migration توافقية واختبار OAuth مع حساب Sandbox لكل منصة.

## Recommended merge gate

أي توحيد لاحق يجب أن يمر عبر طبقة توافق تقرأ schema الحالي وتكتب إلى `social_accounts` و`social_account_tokens`، مع استهلاك state بشكل ذري، والتحقق من عضوية workspace في وظيفة البدء، وعدم إعادة رمز access token إلى الواجهة. ويجب أن يثبت الاختبار أن callback الفاشل يعيد المستخدم إلى مسار التطبيق الصحيح دون تسريب رسالة مزود تحتوي على token أو secret.

