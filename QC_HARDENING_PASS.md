# QC Hardening Pass — تقرير التنفيذ والمعايرة (Aug 2026)

نفّذت الطلب زي ما هو: **مفيش أي لمسة UI/UX أو Performance** — كل التعديلات backend logic بحتة في محرك التقييم نفسه. الملفات اللي اتغيرت:

- `src/types/assistant.ts` — أنواع جديدة (`QualityDimensionKey`, `QualityDimensionResult`, `CRITICAL_QUALITY_DIMENSIONS`) + توسيع `ContentQualityResult`.
- `src/engines/qualityEngine/qualityControl.ts` — الـQC Prompt اتعاد كتابته بالكامل (Adversarial + 12 Dimension)، وparsing جديد يحسب الـscore في الكود مش من الموديل.
- `src/engines/contentEngine/contentGuards.ts` — `evaluateContentApproval` بقى بيطبّق **Critical Dimension Gate** حقيقي، + heuristic جديد للـcliché openers.
- `src/utils/contentIntegrity.ts` — `buildQualityProof` بقى بيرفض بناء الـproof لو أي critical dimension فشل، من غير ما يلمس شكل الـproof أو الـPublish Security Gate نفسه.
- `src/engines/contentEngine/rewriteAgent.ts` — الـImprovement Agent بقى بياخد evidence + suggested_fix حقيقي لكل بُعد فشل، مش رقم بس.
- `tests/contentGuards.reference.mjs` + `tests/contentGuards.test.mjs` — اتحدّثوا بالكامل + اتضاف الـ10-case adversarial test set.
- `src/dev/qcCalibration.ts` — أداة معايرة تشتغل جوه التطبيق (مش هنا، لأن مفيش API access في الـsandbox — تفاصيل تحت).

---

## 1) لا تثق في Score الحالي (Item 1)

- الـscore النهائي بقى **بيتحسب في الكود** (`qualityControl.ts::parseQCResult`) كمتوسط الـ12 بُعد — مش رقم الموديل نفسه. الموديل ممنوع يقول "score: 95" ويفضل الرقم ده معتمد؛ الكود بيحسبه من جديد كل مرة.
- نفس الحاجة لـ`approved` — بقى دايمًا محسوب في `reviewGeneratedContent` عن طريق `evaluateContentApproval`، مش من `json.approved` اللي بيرجعه الموديل.
- `parseStrictQualityPayload`/`evaluateStrictQuality` مكنش أسماء موجودة في الكود الأصلي — اللي موجود هو `parseQCResult` و`evaluateContentApproval`، وهما اللي اتعدلوا هنا.
- كل الـthresholds بقت مركزية في `QC_MIN_SCORE` / `QC_MIN_CRITICAL_DIMENSION` (`contentGuards.ts`) — مفيش fallback بيحول missing/undefined لقيمة ناجحة؛ أي dimension مفقود بيتحط `0` (fail) مش يتجاهل.

## 2) إعادة تعريف الجودة من الصفر (Item 2)

الـ12 بُعد (A-L) بالظبط زي ما طلبت، موجودين في `QualityDimensionKey` وبيتقيّموا كلهم منفصل في الـQC prompt: `idea_value, hook, substance, structure, arabic_quality, naturalness, brand_fit, audience_fit, platform_fit, cta, originality, factual_logical`.

## 3) Critical Dimension Gate (Item 3)

`CRITICAL_QUALITY_DIMENSIONS = [idea_value, hook, arabic_quality, naturalness, brand_fit, platform_fit]`. أي بُعد من دول **لازم يكون ≥90 بمفرده**، بغض النظر عن الـoverall score. أثبتنا ده في test مباشر:

> منشور بدرجات `95×11 + hook=60` → المتوسط = 92 (كان هيعدي لو اعتمدنا على المتوسط بس) → **لكنه بيترفض** لأن `hook` بُعد حرج وأقل من 90.

الأبعاد الغير-حرجة (substance, structure, audience_fit, cta, originality, factual_logical) بتدخل في المتوسط العام لكن مبتفشلش المنشور لوحدها — إلا لو نزلت المتوسط تحت 90.

## 4) QC عدائي/نقدي (Item 4)

الـPrompt الجديد في `buildQCMessages` بيفتح بجملة توجيه صريحة إن دور الموديل عدائي بالكامل ("أنت لست هنا لتوافق... أنت هنا لتجد كل سبب يجعله غير جاهز للنشر")، وبيدّي قائمة صريحة بكل العيوب المطلوب البحث عنها (كلام عام، حشو، تكرار، AI language، Hook ضعيف، CTA مصطنع، إلخ) بنفس الصياغة اللي بعتّها تقريبًا.

## 5) Hard Fail Rules (Item 5)

توسّعت قايمة `critical_issues` من 5 لـ**10** قيم: `factual_error, brand_violation, forbidden_term, platform_violation, unsafe_content, generic_content, unnatural_cta, ai_generated_style, length_mismatch, obvious_repetition`. أي وحدة منهم بترفض المنشور فورًا مهما كانت باقي الدرجات.

## 6) الموديل مبيقيّمش نفسه (Item 6)

الـpipeline الأصلي كان أصلًا بيمنع نفس الموديل يراجع نفسه (`excludeModel` في `reviewGeneratedContent`) — ده كان موجود قبل كده. اللي اتضاف هنا: **حتى الـQC Model نفسه بقى ممنوع يقيّم قراره الخاص** — `quality.approved` اللي بيرجعه بقى متجاهَل تمامًا، والقرار بيتحسب بالكامل في الكود من الدرجات + critical_issues.

## 7) Evidence مش Score بس (Item 7)

كل بُعد بيرجع `{score, status, reason, evidence, suggested_fix}` (`QualityDimensionResult`). الـ`rewriteAgent.ts` بقى بياخد الـevidence وsuggested_fix دول مباشرة ويحطهم في الـbrief بتاع الـImprovement Agent — بالظبط زي المثال اللي بعتّه (hook: score 62, evidence, suggested_fix).

## 8 و9) الـ10-case Adversarial Test + Calibration

ده الجزء اللي محتاج توضيح مهم:

**اللي عملته فعلًا (وشغال دلوقتي، 100%):** كتبت الـ10 حالات بالظبط من طلبك (Bad Post 1-8 + Excellent Post 9 + Excellent-but-Brand-Fit-issue Post 10) في `tests/contentGuards.test.mjs`، وشغّلتهم ضد منطق الـ**Gate نفسه** (مش ضد موديل حقيقي، لأن الـsandbox بتاعي مفيهوش إنترنت/API access للـSupabase Edge Function). النتيجة:

```
Test                                                    | Score | Pass/Fail
Bad Post 1 — كلام عام جدًا                              |  88   | FAIL (idea_value)
Bad Post 2 — Hook ضعيف                                  |  91   | FAIL (hook)
Bad Post 3 — محتوى مليء بالحشو                          |  88   | FAIL (idea_value)
Bad Post 4 — لغة عربية ركيكة                            |  86   | FAIL (arabic_quality, naturalness)
Bad Post 5 — نص AI واضح ومصطنع                          |  90   | FAIL (critical:ai_generated_style)
Bad Post 6 — CTA تسويقي مزعج                            |  90   | FAIL (critical:unnatural_cta)
Bad Post 7 — نفس الفكرة مكررة                           |  90   | FAIL (critical:obvious_repetition)
Bad Post 8 — LinkedIn مكتوب كـFacebook                  |  91   | FAIL (platform_fit)
Excellent Post 9                                        |  95   | PASS
Excellent-but-Brand-Fit Post 10                         |  92   | FAIL (brand_fit)
```

**النتيجة: 10/10 حالات اتصنفت صح** (8 Bad فشلوا، Excellent عدى، Excellent-with-flaw فشل بسبب brand_fit تحديدًا زي المطلوب). ده مُثبت ومتكرر — شغّل `npm test` وهتلاقي 43/43 اختبار عدى.

**اللي محتاج تعمله إنت (ومقدرش أعمله من هنا):** الاختبار اللي فوق بيثبت إن الـ**gate logic** سليم — يعني لو الـQC Model قيّم بُعد معين صح، القرار هيبقى صح. لكنه **مش دليل على إن الموديل الحقيقي (اللي شغال على أي provider عندك) هيدّي نفس الدرجات دي فعليًا** لنفس النصوص — وده محتاج API call حقيقي، ومفيش عندي شبكة هنا أعمله.

عشان تاخد الأرقام الحقيقية (before/after زي ما طلبت):
1. اعمل `git stash` أو checkout لآخر commit قبل هذا التعديل، شغّل `src/dev/qcCalibration.ts` (فيه الـ10 حالات نفسها جاهزة) من browser console وانت logged in — هتاخد أرقام "قبل" الحقيقية.
2. ارجع للتعديل الجديد وكرر نفس الخطوة — هتاخد أرقام "بعد".
3. `runQcCalibration('<workspace_id>')` بيطبع جدول `Test | Score | Pass/Fail | Reason` + متوسط Bad/Good + نسبة التمييز — بالظبط الفورمات اللي طلبته في item 9.

ده مش تهرّب من المطلوب — هو أمانة إني مقدرش أدّعي رقم "قبل/بعد" حقيقي من نموذج AI فعلي وأنا معنديش اتصال بيه دلوقتي.

## 10) الـPublish Security Gate

**متلمسش خالص** — `content_hash`, `quality_proof`, `platform_variant_proof`, `generation_origin`, وserver-side gate في `supabase/functions/_shared/orchestrator.ts` زي ما هما بالظبط. اللي اتغير بس هو شرط بناء الـproof نفسه (`buildQualityProof` في `contentIntegrity.ts`) — بقى برفض يبني proof أصلًا لو أي critical dimension فشل، فالـproof اللي بيوصل للـserver بقى مبني على evaluator أدق، من غير ما ميكانيزم الـgate نفسه يتغير حرف واحد.

## 11) الخلاصة

- **Rubric Audit / Score Calibration:** اتعمل، الملفات فوق.
- **10-case adversarial test:** اتعمل ومُثبت (deterministic، 43/43 pass).
- **Test generated real posts / Compare Bad vs Good:** الجزء ده محتاج تشغيل حقيقي — استخدم `src/dev/qcCalibration.ts`.
- **Improvement Loop يصلح فعليًا العيوب المحددة:** `rewriteAgent.ts` بقى ياخد evidence/suggested_fix حقيقي من كل بُعد فشل، مش بس "حاول تاني".

مفيش أي تعديل في UI أو Performance في أي مكان من التعديل ده.
