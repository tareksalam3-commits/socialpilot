import { sanitizeGeneratedContent, arabicNaturalnessGuard, evaluateContentApproval, validateFinalPostContent } from './contentGuards.reference.mjs';

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}`); }
}

// ---- Item 14: Content Quality Test — must reject known-bad garbled Arabic ----
const bad1 = 'مقاييس حماك قنينة أمان؟ تواصل معي إذا كنت تبحث عن رؤية متميزة.';
const bad2 = 'مالية وظيفتك ليست كارثة، لكنها تحتاج مراجعة عتبة رمادية دائمًا.';
const bad3 = 'مراجعة عتبة رمادية هي أساس كل قرار مالي ناجح في حياتك المهنية اليوم.';

check('bad1 fails arabicNaturalnessGuard', !arabicNaturalnessGuard(bad1).pass);
check('bad2 fails arabicNaturalnessGuard', !arabicNaturalnessGuard(bad2).pass);
check('bad3 fails arabicNaturalnessGuard', !arabicNaturalnessGuard(bad3).pass);

// The three exact garbled examples called out in the spec — each must be
// caught by the deterministic guard before Preview/Schedule, regardless of
// where in a longer post they appear or what punctuation follows them.
const spec1 = 'تتدحرج الأداء إلى معضلة لم يكن أحد يتوقعها في هذا الربع.';
const spec2 = 'مقاييس حماك قنينة أمان؟ هذا هو السؤال الذي يجب أن تطرحه اليوم.';
const spec3 = 'مالية وظيفتك ليست كارثة. لكنها تحتاج إلى خطة واضحة اليوم.';
check('spec phrase 1 ("تتدحرج الأداء إلى معضلة...") fails the guard', !arabicNaturalnessGuard(spec1).pass);
check('spec phrase 1 reason is known_bad_pattern', arabicNaturalnessGuard(spec1).reasons.includes('known_bad_pattern'));
check('spec phrase 2 ("مقاييس حماك قنينة أمان؟") fails the guard', !arabicNaturalnessGuard(spec2).pass);
check('spec phrase 2 reason is known_bad_pattern', arabicNaturalnessGuard(spec2).reasons.includes('known_bad_pattern'));
check('spec phrase 3 ("مالية وظيفتك ليست كارثة.") fails the guard', !arabicNaturalnessGuard(spec3).pass);
check('spec phrase 3 reason is known_bad_pattern', arabicNaturalnessGuard(spec3).reasons.includes('known_bad_pattern'));

// Same three phrases must also block the pre-createPost() Final Validation
// gate — this is what stands between a manually-edited/rescheduled post and
// actually reaching status 'scheduled'.
check('validateFinalPostContent rejects spec phrase 1', validateFinalPostContent(spec1).valid === false);
check('validateFinalPostContent rejects spec phrase 2', validateFinalPostContent(spec2).valid === false);
check('validateFinalPostContent rejects spec phrase 3', validateFinalPostContent(spec3).valid === false);

// A resulting QC verdict with score>=90 but a garbled guard must NOT be approved
const qcHighScoreButGarbled = { approved: true, score: 90, issues: [], suggestions: [], arabic_quality: 90 };
const decisionBad = evaluateContentApproval(bad1, qcHighScoreButGarbled, true);
check('garbled content is never approved even with score=90', decisionBad.approved === false);

// A natural, clean Arabic LinkedIn post with strong sub-scores should be approvable
const good = 'التأمين على الحياة ليس مجرد بوليصة — إنه الالتزام الذي تتركه لعائلتك عندما لا تكون موجودًا لتوفير الأمان بنفسك.\n\nكثير من الناس يؤجلون هذا القرار لأنهم لا يريدون التفكير في الاحتمالات الصعبة، لكن التخطيط المالي الحقيقي يبدأ من مواجهة هذه الأسئلة مبكرًا.\n\nما هي الخطوة التي اتخذتها أنت لحماية دخل عائلتك؟\n\n#التأمين #التخطيط_المالي #الأمان_المالي';
const qcGood = { approved: true, score: 92, issues: [], suggestions: [], arabic_quality: 94, linkedin_fit: 91, brand_fit: 93 };
const decisionGood = evaluateContentApproval(good, qcGood, true);
check('clean content with strong sub-scores is approved', decisionGood.approved === true);

// item 6/8 example: arabic_quality = 55, score = 85 -> must NOT be approved
const qcLowArabic = { approved: true, score: 85, issues: [], suggestions: [], arabic_quality: 55 };
const decisionLowArabic = evaluateContentApproval(good, qcLowArabic, true);
check('score=85 with arabic_quality=55 is rejected (item 6/8)', decisionLowArabic.approved === false);

const qc89 = { approved: true, score: 89, issues: [], suggestions: [], arabic_quality: 95, linkedin_fit: 95, brand_fit: 95 };
check('score=89 is rejected despite strong dimensions', evaluateContentApproval(good, qc89, true).approved === false);
const qc90 = { approved: true, score: 90, issues: [], suggestions: [], arabic_quality: 90, linkedin_fit: 90, brand_fit: 90 };
check('score=90 with all required dimensions passes', evaluateContentApproval(good, qc90, true).approved === true);
check('rejection reason includes arabic_quality_below_minimum', decisionLowArabic.reasons.includes('arabic_quality_below_minimum'));

const qcMissingBrand = { approved: true, score: 95, arabic_quality: 95, linkedin_fit: 95 };
const decisionMissingBrand = evaluateContentApproval(good, qcMissingBrand, true);
check('missing brand_fit is never approved', decisionMissingBrand.approved === false);
check('missing brand_fit has an explicit reason', decisionMissingBrand.reasons.includes('brand_fit_missing'));

// QC unavailable (null) must never be silently approved (item 5 bug fix)
const decisionNullQC = evaluateContentApproval(good, null, true);
check('null QC result is never approved (fixes if(!quality) break bug)', decisionNullQC.approved === false);
check('null QC reason is qc_unavailable', decisionNullQC.reasons.includes('qc_unavailable'));

console.log(`\n--- Content Quality Test: ${pass} passed, ${fail} failed so far ---\n`);

// ---- Item 15: Metadata Leakage Test ----
const leaked1 = 'هذا هو نص المنشور الرائع عن التأمين.\n\nPreview\nPlatform: LinkedIn\nAccount: My Page\nScheduled Time: 5 minutes\nStatus: Awaiting Confirmation';
const s1 = sanitizeGeneratedContent(leaked1);
check('heavy multi-marker leakage triggers regenerate (not silent clean)', s1.action === 'regenerate');

// Note: "Status: Awaiting Confirmation" alone matches TWO distinct marker
// categories (status + awaiting_confirmation), so it correctly triggers
// 'regenerate' under the >=2-distinct-markers rule — verified separately
// above. This case uses a single marker category to exercise 'cleaned'.
const leaked2 = 'هذا هو نص المنشور الرائع عن التأمين على الحياة كأداة أساسية للأمان المالي.\n\nكل عائلة تستحق أن تشعر بالأمان حتى في أصعب الظروف غير المتوقعة في الحياة.\n\nالتخطيط المبكر هو أفضل هدية يمكن أن تقدمها لمن تحب دون تردد أو تأجيل.\nPlatform: LinkedIn';
const s2 = sanitizeGeneratedContent(leaked2);
check('single isolated marker gets cleaned (not passed through)', s2.action === 'cleaned' && !/platform/i.test(s2.content));

const fenced = '```\nهذا نص المنشور بدون أي متاعب فعلية أبدًا في اللغة العربية على الإطلاق.\n```';
const s3 = sanitizeGeneratedContent(fenced);
check('markdown fences are stripped', !s3.content.includes('```'));

const clean = 'هذا نص منشور نظيف تمامًا بدون أي معلومات تشغيلية أو واجهة مستخدم داخل النص على الإطلاق أبدًا.';
const s4 = sanitizeGeneratedContent(clean);
check('clean content passes through untouched (action=ok)', s4.action === 'ok' && s4.content === clean);

// validateFinalPostContent — the pre-createPost() gate
const v1 = validateFinalPostContent(leaked1);
check('validateFinalPostContent rejects leaked metadata before createPost()', v1.valid === false);

const v2 = validateFinalPostContent(good);
check('validateFinalPostContent accepts clean natural Arabic content', v2.valid === true);

console.log(`\n=== TOTAL: ${pass} passed, ${fail} failed ===`);
process.exit(fail > 0 ? 1 : 0);
