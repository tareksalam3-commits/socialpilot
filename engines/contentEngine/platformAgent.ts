import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import type { ChatMessage } from '@/types/ai';
import type { WorkspaceContext, PlatformProfile, PlatformAdaptationResult } from '@/types/context';
import { DEFAULT_DIALECT, type DialectCode } from '@/constants/dialects';
import { buildArabicWritingRules, LINKEDIN_WRITING_RULES } from './arabicWritingRules';
import { stripFence } from './contentGuards';

// ============================================================================
// Platform Adaptation Engine — Phase 2, STEP 10
//
// Input:  Master Content (the Creator Agent's already-QC'd text, hook
//         included) + the list of target platforms for this draft.
// Output: PlatformAdaptationResult — one distinct adapted version per
//         platform (section 16: "لا تستخدم نفس النص لكل المنصات"), each
//         following that platform's Platform Profile (section 17).
//
// Result is stored alongside the draft (DraftPost.platformVariants in
// useAssistantPipeline) as post.metadata.assistant.platform_variants.
// Publishing (supabase/functions/_shared/orchestrator.ts,
// resolveTargetContent) reads the variant for each target's platform when
// one exists and falls back to the master content otherwise — so a post
// authored manually (no variants at all) is unaffected.
//
// Runs through the existing AI Orchestrator -> AI Gateway path, same as
// every other agent — no provider-specific calls here.
// ============================================================================

/** Section 17 Platform Profiles. Plain data on purpose — "قابلة للتعديل
 * مستقبلًا": changing a platform's rules later never touches the agent
 * logic below, only this table. `linkedin_page` intentionally reuses the
 * `linkedin` profile (same platform, company-page variant) rather than
 * duplicating it. Any platform id not covered here (including messaging
 * channels like `whatsapp`, which sit outside section 16's Master Content
 * fan-out) falls back to GENERIC_PROFILE in getPlatformProfile(). */
export const DEFAULT_PLATFORM_PROFILES: Record<string, PlatformProfile> = {
  linkedin: {
    platform: 'linkedin',
    content_length: '120–180 كلمة، فقرات قصيرة (سطر إلى ثلاثة أسطر) مع مسافات بيضاء بين الفقرات',
    tone: 'مهني راقٍ، إنساني، وليس إعلانيًا',
    structure: 'Hook قوي في أول سطر → فكرة واحدة واضحة → Insight حقيقي → نهاية تفتح نقاشًا',
    hook_style: 'جملة افتتاحية قوية ومباشرة — بدون مقدمة عامة أو تمهيد',
    cta_style: 'دعوة لفتح نقاش (سؤال أو رأي)، وليس CTA تسويقي تقليدي مثل "تواصل معي"',
    hashtag_rules: '4 إلى 6 هاشتاجات كحد أقصى، بدون تكرار مزعج لنفس الكلمة',
    media_requirements: 'صورة واحدة عالية الجودة أو بدون صورة؛ لا فيديوهات قصيرة بأسلوب Reels',
    format_rules: 'بدون Emoji إلا إذا كان Brand Voice يسمح صراحة؛ ممنوع المبالغات والوعود التسويقية',
  },
  facebook: {
    platform: 'facebook',
    content_length: '80–150 كلمة',
    tone: 'ودود وقريب من الجمهور، مع الحفاظ على مهنية البراند',
    structure: 'Hook بسيط وجذاب → قيمة أو قصة قصيرة → CTA واضح',
    hook_style: 'جملة قصيرة تثير الفضول أو التفاعل (سؤال مباشر، رأي، أو موقف يومي)',
    cta_style: 'دعوة صريحة للتفاعل (لايك/تعليق/مشاركة) أو زيارة رابط',
    hashtag_rules: 'هاشتاج إلى ثلاثة كحد أقصى، أو بدون هاشتاجات إطلاقًا',
    media_requirements: 'صورة أو فيديو قصير يفضَّل إرفاقه؛ Facebook يفضل المحتوى المرئي',
    format_rules: 'يسمح باستخدام Emoji باعتدال لو Brand Voice يسمح؛ لغة مباشرة وسهلة القراءة',
  },
  instagram: {
    platform: 'instagram',
    content_length: 'كابشن قصير 40–100 كلمة، الفكرة الأساسية في أول سطرين قبل "See more"',
    tone: 'بصري وحيوي، أقرب للإلهام أو الترفيه المهني',
    structure: 'Hook قوي في أول سطرين (يظهر قبل القطع) → جسم قصير → CTA',
    hook_style: 'أول سطرين يجب أن يجذبا الانتباه بمفردهما لأن الباقي يُطوى تلقائيًا',
    cta_style: 'دعوة للتفاعل أو حفظ/مشاركة المنشور',
    hashtag_rules: '5 إلى 10 هاشتاجات مرتبطة بالموضوع، توضع غالبًا في نهاية الكابشن',
    media_requirements: 'صورة أو Reel إلزامي — Instagram منصة بصرية بالكامل',
    format_rules: 'يسمح باستخدام Emoji بشكل طبيعي؛ تجنب الفقرات الطويلة المتصلة',
  },
  x: {
    platform: 'x',
    content_length: 'حتى 280 حرفًا تقريبًا، جملة أو جملتين مركّزتين',
    tone: 'مباشر وحاد، بدون حشو',
    structure: 'فكرة واحدة فقط لكل تغريدة — Hook والفكرة والـCTA في نفس الجملة القصيرة',
    hook_style: 'الجملة الأولى هي التغريدة كلها تقريبًا — يجب أن تكون قوية بذاتها',
    cta_style: 'CTA مختصر جدًا إن وُجد (رد/إعادة نشر)، وغالبًا بدون CTA تقليدي',
    hashtag_rules: 'هاشتاج أو اثنان كحد أقصى، فقط لو مرتبطين مباشرة بالموضوع',
    media_requirements: 'اختياري — صورة واحدة تدعم الفكرة لو متاحة',
    format_rules: 'ممنوع الفقرات؛ الإيجاز إلزامي وليس اختياريًا',
  },
  threads: {
    platform: 'threads',
    content_length: '50–120 كلمة، أسلوب محادثة قصير',
    tone: 'شخصي وعفوي أكثر من LinkedIn، لكن ما زال مهنيًا',
    structure: 'Hook محادثي → فكرة واحدة → سؤال أو رأي يفتح تفاعل الـReplies',
    hook_style: 'يبدأ كأنه جزء من محادثة، وليس إعلانًا رسميًا',
    cta_style: 'دعوة للرد أو المشاركة برأي، بأسلوب غير رسمي',
    hashtag_rules: 'هاشتاج واحد إلى اثنين كحد أقصى، أو بدون هاشتاجات',
    media_requirements: 'اختياري',
    format_rules: 'Emoji مسموح باعتدال؛ لغة قريبة من الحديث الطبيعي',
  },
  tiktok: {
    platform: 'tiktok',
    content_length: 'كابشن قصير جدًا 20–60 كلمة، يكمّل الفيديو ولا يشرحه بالكامل',
    tone: 'حيوي، سريع الإيقاع، قريب من لغة الجمهور الشاب',
    structure: 'Hook يخلق فضول عن محتوى الفيديو → جملة تكمل الفكرة → CTA بسيط',
    hook_style: 'سؤال أو جملة صادمة/مثيرة للفضول تدفع لمشاهدة الفيديو كاملًا',
    cta_style: 'دعوة قصيرة (تابعنا / شاركنا رأيك في الكومنتات)',
    hashtag_rules: '3 إلى 5 هاشتاجات، بينها هاشتاج أو هاشتاجين عامين متعلقين بالمجال',
    media_requirements: 'فيديو إلزامي — الكابشن مكمّل للفيديو وليس بديلًا عنه',
    format_rules: 'Emoji مسموح بكثافة أعلى من باقي المنصات؛ لغة عفوية جدًا',
  },
  telegram: {
    platform: 'telegram',
    content_length: 'مرن حسب المحتوى (يسمح بفقرات أطول من X/Threads)، لكن مقسّم لفقرات قصيرة وواضحة',
    tone: 'إخباري/مباشر — أقرب لرسالة توضيحية منه لمنشور تسويقي',
    structure: 'عنوان أو Hook مختصر → تفاصيل منظمة → رابط أو CTA في النهاية',
    hook_style: 'سطر أول واضح يلخص محتوى الرسالة',
    cta_style: 'رابط أو تعليمات واضحة للخطوة التالية',
    hashtag_rules: 'هاشتاجات اختيارية، وغالبًا غير ضرورية على Telegram',
    media_requirements: 'اختياري — صورة أو ملف مرفق لو داعم للمحتوى',
    format_rules: 'يسمح بتنسيق نصي بسيط (Bold/روابط)؛ بدون لغة إعلانية مبالغ فيها',
  },
};

/** Fallback for any platform id not covered above (e.g. `whatsapp`, or a
 * future platform added to PLATFORM_DEFINITIONS before its profile is
 * authored) — generic, safe defaults rather than a crash or a silently
 * skipped platform. */
const GENERIC_PROFILE: Omit<PlatformProfile, 'platform'> = {
  content_length: 'معتدل — يتبع نفس طول الـMaster Content تقريبًا',
  tone: 'نفس نبرة البراند العامة',
  structure: 'Hook → فكرة أساسية → CTA',
  hook_style: 'جملة افتتاحية واضحة ومباشرة',
  cta_style: 'دعوة واضحة ومباشرة للإجراء المناسب',
  hashtag_rules: 'هاشتاجات معتدلة إن كانت مناسبة للمنصة',
  media_requirements: 'حسب المتاح',
  format_rules: 'يتبع القواعد العامة لكتابة المحتوى الاحترافي',
};

export function getPlatformProfile(platform: string): PlatformProfile {
  const key = platform === 'linkedin_page' ? 'linkedin' : platform;
  return DEFAULT_PLATFORM_PROFILES[key] ?? { platform, ...GENERIC_PROFILE };
}

/** Builds the Platform Adaptation Engine's prompt. Must respond with strict
 * JSON only — same contract as every other pipeline agent. Every requested
 * platform gets its own numbered profile block so the model can't blur
 * platforms together into one generic rewrite. */
function buildPlatformMessages(
  masterContent: string,
  platforms: string[],
  workspaceContext: WorkspaceContext | null,
  dialect: DialectCode,
): ChatMessage[] {
  const includesLinkedIn = platforms.some((p) => p === 'linkedin' || p === 'linkedin_page');
  const brand = workspaceContext?.brand;
  const brandParts: string[] = [];
  if (brand?.tone) brandParts.push(`نبرة البراند: ${brand.tone}`);
  if (brand?.voice) brandParts.push(`الصوت: ${brand.voice}`);
  if (brand?.forbidden_words?.length) brandParts.push(`كلمات ممنوعة: ${brand.forbidden_words.join('، ')}`);
  const brandText = brandParts.length ? brandParts.join('\n') : 'لا تتوفر بيانات Brand DNA إضافية.';

  const profileBlocks = platforms
    .map((p) => {
      const profile = getPlatformProfile(p);
      return `### ${p}
- الطول: ${profile.content_length}
- النبرة: ${profile.tone}
- البنية: ${profile.structure}
- أسلوب الـHook: ${profile.hook_style}
- أسلوب الـCTA: ${profile.cta_style}
- قواعد الهاشتاجات: ${profile.hashtag_rules}
- متطلبات الوسائط: ${profile.media_requirements}
- قواعد التنسيق: ${profile.format_rules}`;
    })
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `أنت "Platform Adaptation Engine" داخل مساعد ذكي لإدارة السوشيال ميديا. مهمتك: تحويل "Master Content" (نص واحد مكتمل ومعتمد) إلى نسخة مستقلة لكل منصة من المنصات المطلوبة أدناه، بحيث تلتزم كل نسخة بـProfile هذه المنصة تحديدًا.

قواعد إلزامية:
- كل نسخة يجب أن تنقل نفس الفكرة الأساسية والـCTA الجوهري للـMaster Content، لكن بصياغة وبنية وطول مختلفَين فعليًا حسب Profile كل منصة — ممنوع تكرار نفس النص حرفيًا بين أي منصتين.
- حافظ على نفس اللهجة العربية (${dialect}) ونفس قواعد الكتابة الطبيعية غير المترجمة آليًا في كل نسخة.
- لا تضف معلومات أو أرقامًا أو ادعاءات غير موجودة أصلًا في الـMaster Content.
- التزم حرفيًا بالكلمات الممنوعة أدناه — يجب ألا تظهر في أي نسخة.
${includesLinkedIn ? `\nقواعد إضافية إلزامية لنسخة LinkedIn تحديدًا:\n${LINKEDIN_WRITING_RULES}\n` : ''}
${buildArabicWritingRules(dialect)}

Brand DNA:
${brandText}

Platform Profiles المطلوب الالتزام بها (نسخة واحدة لكل منصة مذكورة):
${profileBlocks}

أرجع JSON فقط بهذا الشكل بالضبط، بدون أي نص أو Markdown قبله أو بعده — مفتاح لكل منصة من المنصات المذكورة أعلاه بالضبط وبنفس الأسماء:
{"variants": {${platforms.map((p) => `"${p}": string`).join(', ')}}}`,
    },
    {
      role: 'user',
      content: `Master Content:\n"""\n${masterContent}\n"""`,
    },
  ];
}

/** Parses the strict-JSON response. Keeps only keys that were actually
 * requested (never invents a platform that wasn't offered — same rule as
 * Strategy's platform_priorities) and only non-empty string values. Never
 * throws. */
function parseVariants(raw: string, platforms: string[]): Record<string, string> {
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    const rawVariants = (json.variants && typeof json.variants === 'object' ? json.variants : {}) as Record<string, unknown>;
    const variants: Record<string, string> = {};
    for (const p of platforms) {
      const v = rawVariants[p];
      if (typeof v === 'string' && v.trim()) variants[p] = v.trim();
    }
    return variants;
  } catch {
    return {};
  }
}

/** Runs the Platform Adaptation Engine and returns one distinct version per
 * requested platform. Skips the AI call entirely (and just mirrors the
 * master into that single platform) when there's only one target platform
 * — nothing to differentiate against yet, so there's no reason to spend a
 * request. Never throws: on any failure (network, parsing, or a platform
 * missing from the parsed response) that platform's variant is simply
 * absent from `variants` — callers must treat a missing key as "no
 * adapted version yet", falling back to the master content, exactly like
 * every other optional-context result in this pipeline. */
export async function runPlatformAdaptationAgent(
  workspaceId: string,
  masterContent: string,
  platforms: string[],
  workspaceContext: WorkspaceContext | null,
  aiSettings?: { model?: string; temperature?: number; maxTokens?: number },
  dialect: DialectCode = DEFAULT_DIALECT,
): Promise<{ result: PlatformAdaptationResult; error: string | null }> {
  const targetPlatforms = Array.from(new Set(platforms.filter(Boolean)));
  if (!masterContent.trim() || targetPlatforms.length === 0) {
    return { result: { master: masterContent, variants: {} }, error: null };
  }
  if (targetPlatforms.length === 1) {
    return { result: { master: masterContent, variants: { [targetPlatforms[0]]: masterContent } }, error: null };
  }

  const messages = buildPlatformMessages(masterContent, targetPlatforms, workspaceContext, dialect);
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages,
      model: aiSettings?.model,
      temperature: 0.5,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: true,
      brandVoice: null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_platform_adaptation', input: masterContent, output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    const variants = parseVariants(result.content, targetPlatforms);
    return { result: { master: masterContent, variants }, error: Object.keys(variants).length ? null : 'platform_adaptation_parse_failed' };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Platform adaptation failed';
    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_platform_adaptation', input: masterContent, output: null, model: null, status: 'failed' })
      .catch(() => {});
    return { result: { master: masterContent, variants: {} }, error: message };
  }
}
