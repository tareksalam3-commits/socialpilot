# SocialPilot — Integration Manager Audit & Refactor Report

تاريخ: أغسطس 2026
النطاق: تحسين بنية التكاملات الحالية بدون Rebuild، بدون لمس أي OAuth أو Edge Function يعمل حاليًا (وخاصة Meta وLinkedIn).

---

## 1) الوضع الحالي قبل التعديل (Audit)

### Edge Functions الخاصة بالتكاملات (كلها موجودة وتعمل ولم يتم لمسها)

| المنصة | Connect | Callback | Refresh | ملاحظات |
|---|---|---|---|---|
| Meta (Facebook/Instagram) | `meta-oauth-connect` | `meta-oauth-callback` | `meta-token-refresh` | يمر بشاشة اختيار Pages عبر `oauth-selection` |
| LinkedIn | `linkedin-oauth-connect` | `linkedin-oauth-callback` | `linkedin-token-refresh` | يمر أيضًا بـ `oauth-selection` (شخصي/Company Page) |
| Threads | `threads-oauth-connect` | `threads-oauth-callback` | `threads-token-refresh` | نفس Meta App لكن Graph مختلف (`graph.threads.net`) |
| X (Twitter) | `x-oauth-connect` | `x-oauth-callback` | `x-token-refresh` | OAuth2 + PKCE عبر `genericOAuth2.ts` |
| TikTok | `tiktok-oauth-connect` | `tiktok-oauth-callback` | `tiktok-token-refresh` | OAuth2 + PKCE عبر `genericOAuth2.ts`، `client_key` بدل `client_id` |
| Telegram | `telegram-connect` | — (لا يوجد OAuth) | — (Bot Token لا ينتهي) | يتحقق من Bot Token مباشرة على الخادم |
| WhatsApp Business | `whatsapp-connect` | — (لا يوجد OAuth) | — (System User Token يُدار يدويًا) | يتحقق من الرقم عبر Graph API |
| مشترك | `account-sync`, `oauth-selection`, `platform-credentials`, `run-scheduler`, `publish-post`, `automation-control` | | | Business logic للنشر/الجدولة — لم تُمس |
| Shared helpers | `_shared/oauth.ts`, `_shared/credentials.ts`, `_shared/genericOAuth2.ts`, `_shared/pkce.ts`, `_shared/publish.ts`, `_shared/accountHealth.ts`, `_shared/orchestrator.ts`, `_shared/*Refresh.ts` | | | كل التكامل الفعلي (توكنات، نشر، فحص صحة) موجود هنا بالفعل |

### Secrets / Credentials (مخزّنة في جدول `platform_credentials`، مع fallback لمتغيرات البيئة)

```
meta_app_id / META_APP_ID
meta_app_secret / META_APP_SECRET
meta_config_id / META_CONFIG_ID
linkedin_client_id / LINKEDIN_CLIENT_ID
linkedin_client_secret / LINKEDIN_CLIENT_SECRET
x_client_id / X_CLIENT_ID
x_client_secret / X_CLIENT_SECRET
threads_app_id / THREADS_APP_ID
threads_app_secret / THREADS_APP_SECRET
tiktok_client_key / TIKTOK_CLIENT_KEY
tiktok_client_secret / TIKTOK_CLIENT_SECRET
app_url / APP_URL   ← يُستخدم لبناء الـ redirect النهائي بعد نجاح/فشل الربط
```
لم يتم تغيير أي مفتاح أو قيمة من هذه القائمة. Telegram وWhatsApp لا يستخدمان OAuth Client — التوكن الخاص بكل حساب (Bot Token / System User Token) يُدخله المستخدم يدويًا ويُتحقق منه على الخادم مباشرة، ثم يُخزَّن في `connected_accounts.access_token_encrypted` مثل أي منصة أخرى.

### Redirect URIs
كل Callback يبني الـ redirect URI الخاص به ديناميكيًا من `SUPABASE_URL`:
`https://<project>.supabase.co/functions/v1/<platform>-oauth-callback`
وهذا **لم يتغيّر إطلاقًا** — أي تعديل هنا كان سيكسر كل تكامل يعمل حاليًا (Meta وLinkedIn تحديدًا). الرجوع للتطبيق بعد نجاح/فشل الربط يتم عبر `redirectToApp()` التي تقرأ `app_url` من نفس جدول الـ credentials.

### النتيجة المهمة من الـ Audit
الكود الخلفي (Edge Functions) **كان بالفعل** شبه Adapter Pattern:
- `_shared/publish.ts` → دالة واحدة `publishToPlatform(platform, ...)` توزّع على `publishToFacebook/Instagram/LinkedIn/X/Threads/TikTok/Telegram/WhatsApp`.
- `_shared/accountHealth.ts` → دالة واحدة `syncAccount()` توزّع فحص الصحة حسب platform.
- `_shared/genericOAuth2.ts` → `startOAuth2Connect()` و`consumeOAuthState()` مشتركتان بين X وThreads وTikTok (CSRF + PKCE بدون تكرار).
- الواجهة الأمامية فيها بالفعل `src/constants/platforms.ts` كـ Registry شبه كامل (`connectMethod`, `supportsRefresh`, `category`, الأيقونة واللون...).

**الفجوة الوحيدة الحقيقية** كانت في `ConnectedAccountsPage.tsx`: خمس دوال `handleXConnect` منسوخة تقريبًا حرفيًا لكل منصة، وخريطة تسميات مكرَّرة (`REDIRECT_OAUTH_LABEL`) بدل الاعتماد على `PLATFORM_DEFINITIONS`، وعدم وجود مفهوم "Expired" أو زر "Reconnect" موحّد. هذه هي الفجوة التي عالجها هذا التحسين — بدون المساس بأي Edge Function.

---

## 2) التعديلات المطبَّقة

### ملف جديد: `src/integrations/integrationManager.ts`
طبقة تنسيق (orchestration) فقط — لا تتصل بـ Supabase مباشرة ولا تعرف أي Secret:
- `startOAuthConnect(connectMethod, workspaceId)` — نقطة دخول واحدة تختار دالة `accountRepository.start*OAuth` الصحيحة (نفس الاستدعاء لنفس الـ Edge Function القديم تمامًا، فقط dispatch موحّد بدل 5 دوال منسوخة).
- `getAccountDisplayStatus(account)` — يشتق حالة واحدة من خمس حالات: `connected | disconnected | expired | error | warning`، من الحقول الموجودة فعليًا في قاعدة البيانات (`status`, `health_status`, `token_expires_at`) — **بدون أي migration أو عمود جديد**.
- `needsReconnect(account)` — تحدد متى يظهر زر "إعادة الربط".
- `isAvailableForPublishing(account)` — نفس الشرط الذي يطبّقه `_shared/orchestrator.ts` فعليًا عند النشر (`status = 'connected'`)، حتى لا تُظهر الواجهة حسابًا "متاحًا" بينما الخادم سيتجاهله.

### `src/features/accounts/ConnectedAccountsPage.tsx`
- إزالة 5 دوال مكررة (`handleMetaConnect`, `handleLinkedInConnect`, `handleXConnect`, `handleThreadsConnect`, `handleTikTokConnect`) واستبدالها بدالة واحدة `startRedirectOAuth(platform)` تستخدم `integrationManager`.
- إزالة خريطة `REDIRECT_OAUTH_LABEL` المكررة يدويًا.
- إضافة زر **إعادة الربط (Reconnect)** موحّد على كل بطاقة حساب: يعيد نفس مسار OAuth لمنصات Meta/LinkedIn/X/Threads/TikTok، ويفتح نفس نموذج الإدخال لتيليجرام/واتساب.
- إضافة `StatusBadge` تعرض الحالات الخمس (متصل/منتهي/خطأ/تحذير/غير متصل) بدل شارة "healthy/warning/error/unknown" فقط.
- لم يتغيّر أي استدعاء لأي Edge Function، ولا شكل أي طلب/استجابة.

### `src/i18n/translations.ts`
إضافة 3 مفاتيح ترجمة فقط (عربي + إنجليزي): `accounts.card.expired`, `accounts.card.disconnected`, `accounts.card.reconnect`. لا حذف لأي مفتاح موجود.

---

## 3) ما لم يتم لمسه إطلاقًا (بالتصميم)

- كل Edge Functions الخاصة بـ Meta وLinkedIn (connect/callback/refresh) وoauth-selection.
- كل Secrets/Redirect URIs.
- `_shared/publish.ts` (محرك النشر الفعلي لكل منصة).
- `_shared/orchestrator.ts` و`run-scheduler` (منطق الجدولة والـ retry).
- `_shared/accountHealth.ts` (فحص الصحة الدوري).
- أي migration أو بيانات حسابات حالية — لم يتم فصل أو حذف أي حساب Meta/LinkedIn متصل.

---

## 4) اختبار مطلوب قبل النشر (لم أستطع تشغيله هنا لعدم توفر بيئة Supabase/شبكة)

1. **Meta**: اضغط Connect على Meta، تأكد أن نافذة اختيار الـ Pages تظهر كالمعتاد، أكمل الربط، تأكد أن الحساب يظهر بحالة "متصل".
2. **LinkedIn**: نفس الشيء (شخصي + Company Page).
3. **X / TikTok**: اضغط Connect، أكمل الموافقة، تأكد من التحويل الصحيح لصفحة الحسابات مع `?connected=1&platform=x|tiktok`.
4. **زر إعادة الربط الجديد**: على حساب منتهي الصلاحية (أو افصل حسابًا يدويًا من قاعدة البيانات لتجربته)، تأكد أن الزر الجديد "إعادة الربط" يعيد فتح نفس نافذة OAuth الصحيحة.
5. **Telegram/WhatsApp**: تأكد أن "إعادة الربط" يفتح نفس النموذج الحالي بدون تغيير في التحقق من التوكن.
6. تأكد أن **لا يوجد أي تغيير سلوكي** على النشر والجدولة (Publishing Engine) والمساعد الذكي.

---

## 5) التوصية للمستقبل (اختياري، لم يُنفَّذ الآن حتى لا يتوسع نطاق التغيير)

عند إضافة منصة جديدة مستقبلًا (مثلاً Snapchat أو Pinterest)، الخطوات الآن محصورة في:
1. إضافة Edge Functions الخاصة بها (connect/callback/refresh) بنفس نمط `genericOAuth2.ts` الحالي.
2. إضافة سطر واحد في `PLATFORM_DEFINITIONS` (constants/platforms.ts).
3. إضافة سطر واحد في `REDIRECT_OAUTH_STARTERS` بـ `integrationManager.ts`.
4. إضافة `publishToXxx()` واحدة في `_shared/publish.ts` وربطها بسطر واحد في `publishToPlatform()`.

لا حاجة لتعديل أي شاشة UI أو أي منطق نشر/جدولة عند إضافة منصة جديدة بهذا الشكل.
