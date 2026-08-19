# Lead Hunter — AI Research Agent Brain — ملخص التغييرات

## الملفات المعدّلة/المضافة
- `supabase/functions/lead-hunter/researchAgent.ts` — إعادة كتابة كاملة: حلقة PLAN→SEARCH→ANALYZE→VERIFY→REVIEW/STOP حقيقية تستدعي AI في كل جولة.
- `supabase/functions/lead-hunter/connectors/serper.ts` **[جديد]** — Connector بحث حقيقي (Serper.dev): search_web + fetch_public_page.
- `supabase/functions/lead-hunter/index.ts` — ربط الـConnector، قراءة مفاتيح المصادر من `lead_source_secrets`، الاتصال الفعلي بـ`ai-gateway`، كتابة كل النتائج الخام في `lead_source_records` (Candidate Ledger)، حفظ `strategy_notes`.
- `supabase/functions/ai-gateway/index.ts` — Intent جديد `research_agent_reasoning` (4 خطوات: plan_round / extract_candidates / verify_candidate / round_review)، ومسار مصادقة إضافي (additive) لـService Role يسمح للـbackground job بالاتصال بدون جلسة مستخدم.
- `supabase/migrations/20260819120000_0029_lead_hunter_research_agent_brain.sql` **[جديد]** — عمود إضافي واحد فقط: `lead_search_jobs.strategy_notes`.

## لم يتم تعديله
Publishing, Scheduler, Inbox, Analytics, Authentication, Workspace, RLS، وباقي intents الـAI Gateway — كل التغيير إضافي (additive)، لا حذف ولا كسر.

## قبل التشغيل الفعلي
1. طبّق migration رقم 0029 على قاعدة البيانات.
2. Deploy لـ`lead-hunter` و`ai-gateway` edge functions.
3. من شاشة Lead Hunter Admin → Sources: أضف مصدرًا جديدًا بـ connector_key = `serper_search` وألصق مفتاح Serper API الخاص بك، وفعّله.
4. بدون خطوة 3: النظام يتوقف بأمانة عند `NOT_CONFIGURED` — صفر نتائج مزيفة.

## نقاط لم تُختبر فعليًا (تحتاج بيئة بشبكة حقيقية)
- استدعاء Serper API فعليًا (لم يُختبر لعدم وجود شبكة في بيئة التطوير الحالية ولا مفتاح API بعد).
- زمن استجابة/تكلفة AI الفعلية لكل خطوة استدلال ضمن حدود `max_runtime_seconds` الحالية (900 ثانية افتراضيًا).
- أوصي بتشغيل أول Search Job حقيقي ومراقبة `lead_search_jobs.strategy_notes` و`lead_source_records` مباشرة بعد الإضافة، وتعديل الـPrompts في `AGENTS.research_researcher` إذا لزم ضبط دقيق بعد أول نتائج حقيقية.
