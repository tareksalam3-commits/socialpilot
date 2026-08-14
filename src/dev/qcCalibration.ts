/**
 * QC Hardening Pass — live calibration harness (brief items 8/9).
 *
 * This is a DEV-ONLY utility, not wired into any route or UI. The
 * deterministic gating logic (Critical Dimension Gate) is already proven
 * against this exact 10-case set in tests/contentGuards.test.mjs, with zero
 * network access. What that test CANNOT prove is whether the live QC model
 * actually produces the dimension scores it should for real content — that
 * requires an authenticated Supabase session and a configured AI provider,
 * neither of which exist in a sandboxed build environment. Run this from
 * inside the running app (authenticated) to get real numbers:
 *
 *   import { runQcCalibration } from '@/dev/qcCalibration';
 *   await runQcCalibration('<your-workspace-id>');
 *
 * — e.g. paste that into the browser devtools console while logged into
 * the app, or temporarily call it from a `useEffect` on any authenticated
 * page. Prints the exact `Test | Score | Pass/Fail | Reason` table the
 * brief asks for, plus the before/after-style summary (bad-case avg vs.
 * good-case avg, and the pass/fail separation rate) — "before" here means
 * this same set run with the OLD (pre-hardening) prompt/rubric for
 * comparison, if you want that baseline too: check out the previous commit,
 * temporarily run this same harness against it, and diff the two tables.
 */
import { reviewGeneratedContent } from '@/engines/qualityEngine/qualityControl';

type CalibrationCase = {
  name: string;
  content: string;
  platforms: string[];
  expectApproved: boolean;
};

// The exact Bad Post 1-8 / Excellent Post 9 / Excellent-but-flawed Post 10
// set from the brief (item 8), written as realistic Egyptian-Arabic
// LinkedIn posts for a generic B2B SaaS brand voice so every case exercises
// the same platform/dialect rules. Swap `content`/`platforms` per case if
// you want to calibrate against your own workspace's actual Brand Voice.
export const QC_CALIBRATION_CASES: CalibrationCase[] = [
  {
    name: 'Bad Post 1 — كلام عام جدًا',
    content:
      'النجاح في العمل يحتاج مجهود وتركيز والتزام.\n\nكل شخص عايز ينجح لازم يشتغل بجد ويطور نفسه باستمرار.\n\nالنجاح مش سهل بس هو ممكن لو حد فعلاً عايزه.\n\n#نجاح #عمل #تطوير_ذات',
    platforms: ['linkedin'],
    expectApproved: false,
  },
  {
    name: 'Bad Post 2 — Hook ضعيف',
    content:
      'النهاردة عايز أتكلم معاكم عن موضوع مهم شوية.\n\nالموضوع ده هو إدارة الوقت في الشغل، وهو حاجة كل واحد لازم يهتم بيها عشان ينجز أكتر.\n\nحاول تنظم وقتك من الصبح وهتلاقي فرق كبير في إنتاجيتك.\n\n#إدارة_الوقت #إنتاجية',
    platforms: ['linkedin'],
    expectApproved: false,
  },
  {
    name: 'Bad Post 3 — محتوى مليء بالحشو',
    content:
      'في الحقيقة، الموضوع اللي هنتكلم عنه النهاردة مهم جدًا وله أهمية كبيرة في حياتنا العملية بشكل عام.\n\nوطبعًا زي ما كلنا عارفين، فإن التطوير المستمر للذات هو أساس مهم جدًا وضروري للنجاح في أي مجال من المجالات.\n\nولذلك، ننصح الجميع بشكل عام بأنه يهتم بتطوير نفسه باستمرار وبشكل دائم.\n\n#تطوير_ذات',
    platforms: ['linkedin'],
    expectApproved: false,
  },
  {
    name: 'Bad Post 4 — لغة عربية ركيكة (حرفية الترجمة)',
    content:
      'نحن نعمل بجد لكي نجلب لك أفضل الحلول التي سوف تجعل عملك يذهب إلى المستوى التالي بطريقة سهلة وبسيطة جدًا.\n\nهذا هو السبب في أننا نعتقد بأن فريقنا هو الأفضل في هذا المجال بلا منازع.\n\nتواصل معنا اليوم لكي تحصل على المزيد من المعلومات.\n\n#حلول_أعمال',
    platforms: ['linkedin'],
    expectApproved: false,
  },
  {
    name: 'Bad Post 5 — نص AI واضح ومصطنع',
    content:
      'في المشهد التجاري سريع التطور اليوم، يظل الابتكار حجر الزاوية للنجاح المستدام.\n\nإن تبني التكنولوجيا الحديثة يمكّن المؤسسات من تحقيق الكفاءة التشغيلية وتعزيز القيمة المضافة لعملائها.\n\nإن الاستثمار في التحول الرقمي ليس خيارًا بل ضرورة استراتيجية لكل مؤسسة تسعى للريادة.\n\n#ابتكار #تحول_رقمي #ريادة',
    platforms: ['linkedin'],
    expectApproved: false,
  },
  {
    name: 'Bad Post 6 — CTA تسويقي مزعج',
    content:
      'كتير من أصحاب الشركات بيواجهوا مشكلة في متابعة المهام اليومية للفريق، وده بيأثر على الإنتاجية بشكل واضح.\n\nلما بتستخدم أداة واحدة بتجمعلك كل حاجة في مكان واحد، الشغل بيبقى أسهل بكتير والفريق بيقدر يركز على اللي مهم فعلًا.\n\n🔥 متفوتش الفرصة! اضغط لايك وشير وكومنت دلوقتي وتابعنا عشان توصلك كل الجديد!! 🔥\n\n#إنتاجية #إدارة_مهام',
    platforms: ['linkedin'],
    expectApproved: false,
  },
  {
    name: 'Bad Post 7 — نفس الفكرة مكررة',
    content:
      'التخطيط الجيد هو أساس نجاح أي مشروع تجاري.\n\nلو مفيش تخطيط صح من الأول، المشروع هيواجه مشاكل كتير قدامه.\n\nوده معناه إن غياب التخطيط الجيد بيكون سبب رئيسي في فشل المشاريع.\n\nفي النهاية، التخطيط المسبق هو اللي بيحدد نجاح أو فشل أي فكرة تجارية.\n\n#تخطيط #نجاح_المشاريع',
    platforms: ['linkedin'],
    expectApproved: false,
  },
  {
    name: 'Bad Post 8 — منشور LinkedIn مكتوب كأنه Facebook',
    content:
      'يااااه صباح الخير يا جماعة 😍😍\n\nإيه أخباركوا النهاردة؟ 🙌 احنا هنا عشان نحكيلكوا حاجة لطيفة حصلت في الشركة! 🎉\n\nتابعونا وكومنتوا تحت وقولولنا رأيكوا 💬💬 وميرسي إنكوا معانا دايمًا ❤️❤️\n\n#صباح_الخير #فريقنا_الحلو',
    platforms: ['linkedin'],
    expectApproved: false,
  },
  {
    name: 'Excellent Post 9 — منشور ممتاز فعلًا',
    content:
      'أول مرة أطلع تقرير أداء لعميل وألاقي رقم غلط، حسيت إني فشلت في حاجة أساسية في شغلي.\n\nقعدت أراجع كل خطوة، ولقيت إن المشكلة مش في التقرير نفسه، المشكلة إننا كنا بنجمع البيانات من مصادر مختلفة يدويًا كل مرة، وده بيسيب مجال للغلط.\n\nاللي اتغير بعدها مش إننا بقينا "أدق"، إننا بقينا نعتمد على مصدر واحد موثوق للبيانات بدل ما كل واحد في الفريق يجمعها بطريقته.\n\nلو فريقك بيواجه نفس الموقف، السؤال مش "مين غلط"، السؤال هو "المصدر بتاعنا موحد ولا لأ؟"\n\nإيه أكتر خطأ اتعلمت منه في شغلك؟\n\n#تحليل_بيانات #إدارة_فرق',
    platforms: ['linkedin'],
    expectApproved: true,
  },
  {
    name: 'Excellent-but-flawed Post 10 — ممتاز لكن مشكلة Brand Fit',
    content:
      'صدقوني، أرخص حل في السوق مش دايمًا أوحش حل!\n\nكل الناس بتقول "قلل مصاريفك"، بس محدش بيقولك إزاي تقلل من غير ما جودة شغلك تنزل.\n\nجرّبنا كذا أداة رخيصة، وفي الآخر رجعنا ندفع أكتر عشان نصلح اللي خربته الأداة الرخيصة من الأول.\n\nإيه رأيكم، فلوسكم بترمى في حاجات "رخيصة" وفي الآخر بتكلفكم أكتر؟\n\n#توفير #قرارات_شغل',
    platforms: ['linkedin'],
    // Content itself reads well, but the brief's Test 10 is specifically an
    // otherwise-strong post with a Brand Fit problem (e.g. a brand whose
    // Voice/Tone in Brand Voice settings is formal/corporate — this casual,
    // slightly confrontational "صدقوني" tone would fail brand_fit for that
    // workspace even though every other dimension holds up). Point this at
    // a workspace with a formal Brand Voice configured to see the expected
    // brand_fit failure; against a workspace with no Brand Voice configured
    // at all, brand_fit may pass and this case would (correctly) approve —
    // that's not a bug, it means there was nothing to violate.
    expectApproved: false,
  },
];

export async function runQcCalibration(workspaceId: string): Promise<void> {
  const rows: { Test: string; Score: number | string; 'Pass/Fail': string; Reason: string }[] = [];
  let badScoreSum = 0;
  let badCount = 0;
  let goodScoreSum = 0;
  let goodCount = 0;
  let separationOk = 0;

  for (const testCase of QC_CALIBRATION_CASES) {
    const { result } = await reviewGeneratedContent(workspaceId, testCase.content, testCase.platforms, null);
    const score = result?.score ?? 'N/A';
    const approved = result?.approved ?? false;
    const reason = approved
      ? '-'
      : result?.dimensions
        ? Object.entries(result.dimensions)
            .filter(([, d]) => d?.status === 'fail')
            .map(([k, d]) => `${k}=${d?.score}`)
            .join(', ') || (result?.critical_issues?.join(', ') ?? 'unknown')
        : 'qc_unavailable';

    rows.push({ Test: testCase.name, Score: score, 'Pass/Fail': approved ? 'PASS' : 'FAIL', Reason: reason });

    if (testCase.name.startsWith('Bad')) {
      badCount++;
      if (typeof score === 'number') badScoreSum += score;
    } else {
      goodCount++;
      if (typeof score === 'number') goodScoreSum += score;
    }
    if (approved === testCase.expectApproved) separationOk++;
  }

  // eslint-disable-next-line no-console
  console.table(rows);
  // eslint-disable-next-line no-console
  console.log(
    `Bad-case avg score: ${badCount ? Math.round(badScoreSum / badCount) : 'N/A'}/100 | ` +
      `Good-case avg score: ${goodCount ? Math.round(goodScoreSum / goodCount) : 'N/A'}/100 | ` +
      `Separation: ${separationOk}/${QC_CALIBRATION_CASES.length} cases matched expected pass/fail`,
  );
}
