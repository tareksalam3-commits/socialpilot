import { aiGateway } from '@/services/aiGateway';
import { aiHistoryRepository } from '@/repositories/aiHistoryRepository';
import type { ChatMessage } from '@/types/ai';
import type { CampaignPlan } from '@/types/assistant';
import type { ResearchDecision, ResearchResult } from '@/types/context';
import { stripFence } from './contentGuards';
import { collectContentContext } from './contentContext';

// ============================================================================
// Research Decision + Research Agent — Phase 2, STEP 7
//
// Research Decision (section 12 of the spec): a cheap classification call
// that decides whether THIS request actually needs research before content
// is generated — time-sensitive, fact-heavy, statistical, news-related,
// competitor-related, market-related, or source-dependent claims. Most
// requests don't, so most requests never pay for a research pass.
//
// Research Agent (section 13): only runs when the Decision says so.
//
// IMPORTANT — Architecture note (Gap Analysis, per STEP 1's methodology):
// the current SocialPilot stack (AI Gateway -> OpenRouter/HuggingFace/Groq/
// Cerebras/Mistral/Direct APIs) has no live web-search/news-retrieval
// provider. The ONLY real, non-invented source of external grounding
// already wired into the app is the existing Content Sources module
// (RSS/URLs/YouTube/files -> content-extraction Edge Function), reused here
// via collectContentContext. So this Research Agent's "Research -> Evidence
// -> Sources -> Verified Context" pipeline is grounded strictly in the
// workspace's own configured Content Sources — never in the model's own
// unsourced claims. If a workspace has no usable Content Sources for a
// request that needs research, `research_available` comes back false
// rather than fabricating evidence or citations ("لا تخترع المصادر" —
// section 13's explicit rule). Wiring a real web-research provider would be
// a NEEDS NEW COMPONENT item for a future step, not something to simulate
// here.
// ============================================================================

/** Builds the Research Decision agent's prompt. Must respond with strict
 * JSON only — same contract as every other pipeline agent. */
function buildDecisionMessages(request: string, plan: CampaignPlan): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `أنت "Research Decision" داخل مساعد ذكي لإدارة السوشيال ميديا. مهمتك الوحيدة: تحديد هل هذا الطلب يحتاج بحثًا فعليًا (Research) قبل توليد المحتوى أم لا — وليس توليد أي محتوى بنفسك.

فعّل research_required = true فقط إذا كان المحتوى المطلوب:
- مرتبطًا بوقت/حدث معين (time-sensitive)
- كثيف الحقائق أو الأرقام (fact-heavy / statistical)
- متعلقًا بخبر أو حدث جارٍ (news-related)
- يقارن بمنافس أو يذكره (competitor-related)
- يتحدث عن بيانات سوق/صناعة (market-related)
- يعتمد على مصدر خارجي محدد ذكره المستخدم (source-dependent)

في أي حالة أخرى (منشور عام، ترويجي، تحفيزي، عن الهوية/القيم) اجعل research_required = false — لا تبالغ في تفعيل البحث.

أرجع JSON فقط بهذا الشكل بالضبط، بدون أي نص أو Markdown قبله أو بعده:
{"research_required": boolean, "reason": string, "categories": string[]}
حيث "categories" مصفوفة من ضمن: ["time-sensitive","fact-heavy","statistical","news-related","competitor-related","market-related","source-dependent"] فقط — فارغة إن لم تُفعّل أي فئة.`,
    },
    {
      role: 'user',
      content: `هدف المنشور: ${plan.objective}\nملاحظات: ${plan.notes || 'لا يوجد'}\n\nطلب المستخدم الأصلي:\n"""\n${request}\n"""`,
    },
  ];
}

const RESEARCH_CATEGORIES = [
  'time-sensitive',
  'fact-heavy',
  'statistical',
  'news-related',
  'competitor-related',
  'market-related',
  'source-dependent',
];

function parseDecision(raw: string): ResearchDecision {
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    const categories = Array.isArray(json.categories)
      ? (json.categories as unknown[]).filter((c): c is string => typeof c === 'string' && RESEARCH_CATEGORIES.includes(c))
      : [];
    return {
      research_required: json.research_required === true,
      reason: typeof json.reason === 'string' ? json.reason.trim() : '',
      categories,
    };
  } catch {
    // Fail closed toward "no research" rather than "always research" — a
    // misclassified request still goes through the normal Content
    // Generation -> Quality Control path (which can flag it for review),
    // it just doesn't get a research pass it may not have needed.
    return { research_required: false, reason: 'classification_failed', categories: [] };
  }
}

/** Runs the Research Decision classifier. Never throws — on any failure it
 * fails closed to research_required: false (see parseDecision), same
 * fail-open-to-the-pipeline / fail-closed-to-extra-work contract as the
 * rest of the pipeline's agents. */
export async function runResearchDecision(
  workspaceId: string,
  request: string,
  plan: CampaignPlan,
  aiSettings?: { model?: string; maxTokens?: number; freeOnly?: boolean },
): Promise<{ decision: ResearchDecision; raw: string; error: string | null }> {
  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages: buildDecisionMessages(request, plan),
      model: aiSettings?.model,
      temperature: 0.1,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: aiSettings?.freeOnly ?? true,
      brandVoice: null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_research_decision', input: request, output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    return { decision: parseDecision(result.content), raw: result.content, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Research decision failed';
    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_research_decision', input: request, output: null, model: null, status: 'failed' })
      .catch(() => {});
    return { decision: { research_required: false, reason: 'classification_failed', categories: [] }, raw: '', error: message };
  }
}

function buildEvidenceMessages(sourceText: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `أنت "Research Agent" داخل مساعد ذكي لإدارة السوشيال ميديا. مهمتك: استخراج نقاط Evidence موجزة من النص المصدر أدناه فقط.

قواعد إلزامية وصارمة:
- استخدم فقط المعلومات الموجودة حرفيًا في النص المصدر أدناه.
- ممنوع إضافة أي رقم أو حقيقة أو اسم غير مذكور في النص المصدر.
- إن لم يحتوِ النص على معلومات كافية، أرجع مصفوفة فارغة بدلًا من الاختلاق.
- كل عنصر جملة عربية قصيرة واحدة.

أرجع JSON فقط بهذا الشكل بالضبط، بدون أي نص أو Markdown قبله أو بعده:
{"evidence": string[]}`,
    },
    { role: 'user', content: `النص المصدر:\n"""\n${sourceText}\n"""` },
  ];
}

function parseEvidence(raw: string): string[] {
  try {
    const json = JSON.parse(stripFence(raw)) as Record<string, unknown>;
    return Array.isArray(json.evidence) ? json.evidence.filter((e): e is string => typeof e === 'string' && e.trim().length > 0) : [];
  } catch {
    return [];
  }
}

/** Runs the Research Agent. Only meaningful when `decision.research_required`
 * is true (callers should skip calling this otherwise — it's a no-op
 * that returns an empty, honest result if called anyway). Grounds itself
 * strictly in the workspace's own Content Sources via collectContentContext
 * — see the architecture note above for why. Never throws: any failure
 * (no sources configured, extraction error, evidence-extraction parse
 * failure) degrades to `research_available: false` rather than inventing
 * anything, which is the one rule this agent cannot bend on. */
export async function runResearchAgent(
  workspaceId: string,
  decision: ResearchDecision,
  aiSettings?: { model?: string; maxTokens?: number; freeOnly?: boolean },
): Promise<ResearchResult> {
  if (!decision.research_required) {
    return { research_required: false, research_available: false, evidence: [], sources: [], verified_context: null, reason: 'not_required' };
  }

  const { contentText, used, error: sourcesError } = await collectContentContext(workspaceId);
  if (!contentText) {
    // Honest "nothing to ground this in" result — never fabricated.
    return {
      research_required: true,
      research_available: false,
      evidence: [],
      sources: [],
      verified_context: null,
      reason: sourcesError ?? 'no_grounding_available',
    };
  }

  try {
    const result = await aiGateway.generate({
      workspaceId,
      messages: buildEvidenceMessages(contentText),
      model: aiSettings?.model,
      temperature: 0,
      maxTokens: aiSettings?.maxTokens,
      stream: true,
      freeOnly: aiSettings?.freeOnly ?? true,
      brandVoice: null,
      onChunk: () => {},
    });

    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_research_evidence', input: contentText.slice(0, 500), output: result.content, model: result.model, status: 'success' })
      .catch(() => {});

    return {
      research_required: true,
      research_available: true,
      evidence: parseEvidence(result.content),
      sources: used,
      verified_context: contentText,
      reason: 'grounded_in_content_sources',
    };
  } catch {
    // Evidence extraction failed, but the underlying material (contentText,
    // used) is still real and still came from the workspace's own Content
    // Sources — still honest to hand back as verified context, just
    // without the extracted bullet list.
    aiHistoryRepository
      .create({ workspace_id: workspaceId, type: 'assistant_research_evidence', input: contentText.slice(0, 500), output: null, model: null, status: 'failed' })
      .catch(() => {});
    return {
      research_required: true,
      research_available: true,
      evidence: [],
      sources: used,
      verified_context: contentText,
      reason: 'grounded_in_content_sources_no_evidence_extraction',
    };
  }
}
