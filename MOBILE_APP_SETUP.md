# دليل تفعيل تجربة الموبايل الجديدة (PWA محسّن + Push Notifications)

هذا الملف بيشرح خطوة بخطوة إزاي تفعّل كل حاجة اتضافت. الكود اتضاف كامل، لكن في خطوات لازم تعملها إنت لأنها محتاجة اتصال إنترنت / أسرار (secrets) مش متاحة هنا.

## 1) تثبيت الـ dependencies الجديدة

```bash
npm install
```

ده هيثبت مكتبات workbox الجديدة اللي الـ service worker المخصص (`src/sw.ts`) محتاجها.

## 2) تجربة الـ PWA محليًا

الـ service worker متعطّل في وضع `npm run dev` عمدًا (زي ما كان قبل كده). لازم تعمل build:

```bash
npm run build
npm run preview
```

افتح الرابط على الموبايل (أو من DevTools > Application > Service Workers على الديسكتوب) وتأكد إن:
- التطبيق بيتثبت (Add to Home Screen / بانر التثبيت بيظهر)
- الـ bottom tab bar بيظهر على شاشة موبايل (اعمل resize للمتصفح أو افتحه فعليًا من موبايل)
- Pull-to-refresh شغّال (اسحب لأسفل من أعلى أي صفحة وإنت على جهاز فيه touch)

## 3) تفعيل Push Notifications (الإشعارات الفورية)

### أ) ولّد مفاتيح VAPID

```bash
npx web-push generate-vapid-keys
```

هتاخد `Public Key` و `Private Key`.

### ب) الفرونت إند

في `.env` (أو إعدادات Environment Variables في Vercel):

```
VITE_VAPID_PUBLIC_KEY=<الـ Public Key اللي طلع فوق>
```

### ج) الباك إند (Supabase Edge Function secrets)

```bash
supabase secrets set VAPID_PUBLIC_KEY=<نفس الـ Public Key>
supabase secrets set VAPID_PRIVATE_KEY=<الـ Private Key>
supabase secrets set VAPID_SUBJECT=mailto:support@yourapp.com
```

### د) نشر الـ migration والـ edge function

```bash
supabase db push
supabase functions deploy send-push --no-verify-jwt=false
```

> ملاحظة: `send-push` بيتنادى داخليًا بس من الـ database trigger (زي `run-scheduler` بالظبط)، فمش محتاج `--no-verify-jwt` — بيتحقق من الـ Authorization header بنفسه (service role key).

### هـ) تأكد إن `app_secrets` متظبطة (لو مش متظبطة قبل كده للـ scheduler)

```sql
insert into app_secrets (key, value) values
  ('functions_base_url', 'https://<project-ref>.functions.supabase.co'),
  ('service_role_key', '<service role key بتاعك>')
on conflict (key) do update set value = excluded.value;
```

لو دي متظبطة بالفعل عشان `run-scheduler` شغّال عندك، مفيش حاجة تعملها هنا.

### و) جرّب

من داخل التطبيق: Settings/الإشعارات > "تفعيل الإشعارات" > وافق على إذن المتصفح. لو حصل أي `notification` جديدة في جدول `notifications` بعد كده، المفروض توصلك إشعار فعلي حتى لو التطبيق مقفول (على أندرويد/ديسكتوب — iOS يحتاج تثبيت PWA على الشاشة الرئيسية الأول، Safari لسه بيدعم push بس للتطبيقات المثبتة، من iOS 16.4+).

## ملاحظات مهمة

- **iOS**: الإشعارات الفورية على آيفون بتشتغل بس لو التطبيق متثبت على الشاشة الرئيسية (مش من جوه Safari تبويب عادي) — من iOS 16.4 فما فوق. البانر (`InstallPrompt`) بيوضّح للمستخدم إزاي يثبت.
- **التطبيق مش لسه على App Store / Google Play** — لسه PWA. لو حبيت بعدين تطلعه على المتاجر فعليًا (زي فيسبوك تمامًا)، ده مسار تاني (Capacitor) مختلف عن اللي اتعمل هنا.
- الـ bottom nav بيغطي 4 تبويبات أساسية بس (المساعد، المنشورات، الصندوق، الإشعارات) + زر "المزيد" بيفتح القائمة الكاملة الجانبية. ممكن تغيّر التبويبات في `src/layouts/BottomNav.tsx`.
