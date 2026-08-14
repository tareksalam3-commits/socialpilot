import { sanitizeGeneratedContent, arabicNaturalnessGuard, evaluateContentApproval, validateFinalPostContent, makeQuality } from './contentGuards.reference.mjs';

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
const qcHighScoreButGarbled = makeQuality({});
const decisionBad = evaluateContentApproval(bad1, qcHighScoreButGarbled, true);
check('garbled content is never approved even with score=90', decisionBad.approved === false);

// A natural, clean Arabic LinkedIn post with strong sub-scores should be approvable
const good = 'التأمين على الحياة ليس مجرد بوليصة — إنه الالتزام الذي تتركه لعائلتك عندما لا تكون موجودًا لتوفير الأمان بنفسك.\n\nكثير من الناس يؤجلون هذا القرار لأنهم لا يريدون التفكير في الاحتمالات الصعبة، لكن التخطيط المالي الحقيقي يبدأ من مواجهة هذه الأسئلة مبكرًا.\n\nما هي الخطوة التي اتخذتها أنت لحماية دخل عائلتك؟\n\n#التأمين #التخطيط_المالي #الأمان_المالي';
const qcGood = makeQuality({ arabic_quality: 94, platform_fit: 91, brand_fit: 93 });
const decisionGood = evaluateContentApproval(good, qcGood, true);
check('clean content with strong sub-scores is approved', decisionGood.approved === true);

// item 6/8 example: arabic_quality = 55, score = 85 -> must NOT be approved
const qcLowArabic = makeQuality({ arabic_quality: 55 });
const decisionLowArabic = evaluateContentApproval(good, qcLowArabic, true);
check('arabic_quality=55 is rejected (item 6/8) even though other dims are 95', decisionLowArabic.approved === false);
check('rejection reason includes arabic_quality_below_minimum', decisionLowArabic.reasons.includes('arabic_quality_below_minimum'));

// QC Hardening Pass item 3: "95+95+95+60" must never average into a pass —
// a single weak CRITICAL dimension (hook=60) fails approval outright even
// though score = mean(95×11, 60)/12 ≈ 92, which alone would clear 90.
const qcMaskedWeakness = makeQuality({ hook: 60 });
const decisionMasked = evaluateContentApproval(good, qcMaskedWeakness, true);
check('overall score ~92 does not mask a critical hook=60 (item 3)', decisionMasked.approved === false);
check('masked-weakness rejection reason includes hook_below_minimum', decisionMasked.reasons.includes('hook_below_minimum'));

// A non-critical dimension scoring low (cta=60) should NOT by itself block
// approval the way a critical one does, as long as it doesn't drag the
// overall mean below 90.
const qcWeakCtaOnly = makeQuality({ cta: 75, originality: 80 });
check('a weak-but-non-critical dimension does not block approval on its own', evaluateContentApproval(good, qcWeakCtaOnly, true).approved === true);

const qc89 = makeQuality({ idea_value: 89, hook: 89, substance: 89, structure: 89, arabic_quality: 89, naturalness: 89, brand_fit: 89, audience_fit: 89, platform_fit: 89, cta: 89, originality: 89, factual_logical: 89 });
check('score=89 is rejected despite uniformly-89 dimensions', evaluateContentApproval(good, qc89, true).approved === false);
const qc90 = makeQuality({ idea_value: 90, hook: 90, substance: 90, structure: 90, arabic_quality: 90, naturalness: 90, brand_fit: 90, audience_fit: 90, platform_fit: 90, cta: 90, originality: 90, factual_logical: 90 });
check('score=90 with all required dimensions passes', evaluateContentApproval(good, qc90, true).approved === true);

const qcMissingBrand = { approved: false, score: 95, arabic_quality: 95, linkedin_fit: 95, issues: [], suggestions: [] };
const decisionMissingBrand = evaluateContentApproval(good, qcMissingBrand, true);
check('missing brand_fit (legacy shape, no dimensions) is never approved', decisionMissingBrand.approved === false);
check('missing brand_fit has an explicit reason', decisionMissingBrand.reasons.includes('brand_fit_missing'));

// QC unavailable (null) must never be silently approved (item 5 bug fix)
const decisionNullQC = evaluateContentApproval(good, null, true);
check('null QC result is never approved (fixes if(!quality) break bug)', decisionNullQC.approved === false);
check('null QC reason is qc_unavailable', decisionNullQC.reasons.includes('qc_unavailable'));

console.log(`\n--- Content Quality Test: ${pass} passed, ${fail} failed so far ---\n`);

// ---- QC Hardening Pass — 10-case adversarial calibration set (brief items 8/9) ----
// These are NOT a live model calibration (that requires a real aiGateway
// call against a configured provider, which this sandbox has no network
// access to run — see the calibration report handed back alongside this
// change). What IS verified here, deterministically, is that the GATING
// LOGIC itself — evaluateContentApproval's Critical Dimension Gate — can
// tell each of these 10 cases apart correctly *given* the dimension scores
// a properly-calibrated QC pass should produce for each. This is the
// necessary (but not sufficient on its own) condition for real calibration:
// if the gate logic couldn't separate these even with correct inputs, no
// prompt tuning on the model side could fix it either.
const calibrationCases = [
  { name: 'Bad 1 — كلام عام جدًا (no specific idea/value)', quality: makeQuality({ idea_value: 55, substance: 50 }), expectApproved: false },
  { name: 'Bad 2 — Hook ضعيف', quality: makeQuality({ hook: 45 }), expectApproved: false },
  { name: 'Bad 3 — محتوى مليء بالحشو', quality: makeQuality({ substance: 40, idea_value: 60 }), expectApproved: false },
  { name: 'Bad 4 — لغة عربية ركيكة', quality: makeQuality({ arabic_quality: 35, naturalness: 50 }), expectApproved: false },
  { name: 'Bad 5 — نص AI واضح ومصطنع', quality: makeQuality({ naturalness: 40 }, { critical_issues: ['ai_generated_style'] }), expectApproved: false },
  { name: 'Bad 6 — CTA تسويقي مزعج', quality: makeQuality({ cta: 40 }, { critical_issues: ['unnatural_cta'] }), expectApproved: false },
  { name: 'Bad 7 — نفس الفكرة مكررة', quality: makeQuality({ originality: 35 }, { critical_issues: ['obvious_repetition'] }), expectApproved: false },
  { name: 'Bad 8 — منشور LinkedIn مكتوب كأنه Facebook', quality: makeQuality({ platform_fit: 45 }), expectApproved: false },
  { name: 'Excellent 9 — منشور ممتاز فعلًا', quality: makeQuality({}), expectApproved: true },
  { name: 'Excellent-but-flawed 10 — ممتاز مع مشكلة Brand Fit', quality: makeQuality({ brand_fit: 60 }), expectApproved: false },
];

console.log('Test | Score | Pass/Fail | Reason');
for (const c of calibrationCases) {
  const decision = evaluateContentApproval(good, c.quality, true);
  const passFail = decision.approved ? 'PASS' : 'FAIL';
  const reason = decision.approved ? '-' : decision.reasons.filter((r) => !r.startsWith('guard:')).join(', ');
  console.log(`${c.name} | ${c.quality.score} | ${passFail} | ${reason}`);
  check(`${c.name} → approved=${c.expectApproved}`, decision.approved === c.expectApproved);
}

const badCases = calibrationCases.filter((c) => c.name.startsWith('Bad'));
const badAvg = Math.round(badCases.reduce((s, c) => s + c.quality.score, 0) / badCases.length);
const goodCases = calibrationCases.filter((c) => c.name.startsWith('Excellent'));
const goodAvg = Math.round(goodCases.reduce((s, c) => s + c.quality.score, 0) / goodCases.length);
console.log(`\nBad-case avg score: ${badAvg}/100 (all correctly FAIL via the Critical Dimension Gate / critical_issues) | Excellent-case avg score: ${goodAvg}/100`);
check('bad cases average score is below the 90 pass bar', badAvg < 90);
check('every bad case is rejected regardless of its averaged score', calibrationCases.filter((c) => c.name.startsWith('Bad')).every((c) => evaluateContentApproval(good, c.quality, true).approved === false));

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
