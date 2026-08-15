import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Intent =
  | 'generate_brand_dna'
  | 'create_content'
  | 'create_content_plan'
  | 'analyze_performance'
  | 'suggest_ideas'
  | 'general_advice';

type RequestBody = {
  intent: Intent;
  workspaceId: string;
  brandDnaId?: string;
  message: string;
  platforms?: string[];
  context?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Supabase admin client (service role bypasses RLS)
// ---------------------------------------------------------------------------

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  { auth: { persistSession: false } }
);

// ---------------------------------------------------------------------------
// Authorization — verify the caller is authenticated and a workspace member
// ---------------------------------------------------------------------------

function jsonError(status: number, error: string): Response {
  return new Response(
    JSON.stringify({ error }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function authorize(req: Request, workspaceId: string): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token) {
    return { ok: false, response: jsonError(401, 'Missing authentication token') };
  }

  // Verify the JWT and get the user
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    return { ok: false, response: jsonError(401, 'Invalid or expired token') };
  }

  const userId = userData.user.id;

  // Verify the user is a member of the requested workspace
  const { data: membership, error: memberError } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();

  if (memberError || !membership) {
    return { ok: false, response: jsonError(403, 'You do not have access to this workspace') };
  }

  return { ok: true, userId };
}

// ---------------------------------------------------------------------------
// Model Router — picks model based on task complexity
// ---------------------------------------------------------------------------

const MODEL_ROUTING: Record<Intent, { model: string; tier: 'fast' | 'default' | 'strong' }> = {
  generate_brand_dna: { model: 'gpt-4o', tier: 'strong' },
  create_content: { model: 'gpt-4o', tier: 'default' },
  create_content_plan: { model: 'gpt-4o', tier: 'strong' },
  analyze_performance: { model: 'gpt-4o-mini', tier: 'fast' },
  suggest_ideas: { model: 'gpt-4o-mini', tier: 'fast' },
  general_advice: { model: 'gpt-4o-mini', tier: 'fast' },
};

const DEFAULT_MODEL = 'gpt-4o-mini';

function pickModel(intent: Intent): { model: string; provider: string } {
  const route = MODEL_ROUTING[intent] ?? { model: DEFAULT_MODEL, tier: 'fast' as const };
  return { model: route.model, provider: 'openai' };
}

// ---------------------------------------------------------------------------
// AI call — proxies to OpenAI-compatible endpoint via server-side key
// ---------------------------------------------------------------------------

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  jsonMode = false
): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('AI service is not configured. An admin must set the OPENAI_API_KEY secret.');
  }

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI provider error (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? '';
  const tokensIn = data.usage?.prompt_tokens ?? 0;
  const tokensOut = data.usage?.completion_tokens ?? 0;
  return { content, tokensIn, tokensOut };
}

// ---------------------------------------------------------------------------
// Context Assembly — gather only relevant brand + memory context per intent
// ---------------------------------------------------------------------------

async function assembleContext(workspaceId: string, intent: Intent): Promise<{
  brand: Record<string, unknown> | null;
  memory: { key: string; value: string; type: string }[];
}> {
  const needsBrand = intent !== 'generate_brand_dna';
  const needsMemory = intent !== 'generate_brand_dna';

  const tasks: Promise<unknown>[] = [];

  if (needsBrand) {
    tasks.push(
      supabase.from('brand_dna').select('*').eq('workspace_id', workspaceId).maybeSingle()
    );
  } else {
    tasks.push(Promise.resolve(null));
  }

  if (needsMemory) {
    tasks.push(
      supabase
        .from('brand_memory')
        .select('key, value, type')
        .eq('workspace_id', workspaceId)
        .order('updated_at', { ascending: false })
        .limit(20)
    );
  } else {
    tasks.push(Promise.resolve({ data: [] }));
  }

  const [brandRes, memRes] = await Promise.all(tasks) as [
    { data: Record<string, unknown> | null },
    { data: { key: string; value: string; type: string }[] | null }
  ];

  return {
    brand: brandRes?.data ?? null,
    memory: memRes?.data ?? [],
  };
}

function brandContextString(brand: Record<string, unknown> | null): string {
  if (!brand) return 'لا يوجد Brand DNA بعد.';
  const parts: string[] = [];
  const basics = brand.basics as Record<string, string> | undefined;
  if (basics) parts.push(`البراند: ${basics.name ?? 'غير معروف'} — ${basics.description ?? ''}`);
  const identity = brand.identity as Record<string, unknown> | undefined;
  if (identity) parts.push(`الهوية: ${JSON.stringify(identity)}`);
  const tone = brand.tone as Record<string, unknown> | undefined;
  if (tone) parts.push(`النبرة: ${JSON.stringify(tone)}`);
  const audience = brand.audience as Record<string, unknown> | undefined;
  if (audience) parts.push(`الجمهور: ${JSON.stringify(audience)}`);
  const content = brand.content as Record<string, unknown> | undefined;
  if (content) parts.push(`المحتوى: ${JSON.stringify(content)}`);
  return parts.join('\n');
}

function memoryContextString(memory: { key: string; value: string; type: string }[]): string {
  if (memory.length === 0) return 'لا توجد ذاكرة سابقة.';
  return memory.map((m) => `- [${m.type}] ${m.key}: ${m.value}`).join('\n');
}

// ---------------------------------------------------------------------------
// Agents — each agent has a focused system prompt + responsibility
// ---------------------------------------------------------------------------

const AGENTS = {
  brand_intelligence: (brandStr: string) =>
    `أنت Brand Intelligence Agent. مهمتك بناء هوية براند كاملة من معلومات أساسية بسيطة.
استخرج: Identity, Positioning, Values, Differentiators, Tone, Voice, Personas, Content Pillars, Preferred Topics, Forbidden Topics, CTA Style, Vocabulary.
لا تخترع معلومات أو أسعار أو نتائج. إذا لم تكن تعرف شيئًا، اكتب "غير محدد".
سياق البراند الأساسي:\n${brandStr}`,

  content_creator: (brandStr: string, memStr: string) =>
    `أنت Content Creator Agent متخصص في كتابة محتوى تسويقي عربي قوي وجذاب.
اكتب محتوى أصلي، طبيعي، وقريب من القارئ. تجنب المقدمات الطويلة العامة.
لكل منصة، اكتب نسخة مخصصة: نبرة، طول، هاشتاجات، CTA، وفورمات يناسب المنصة.
لا تكرر نفس النص عبر المنصات. التزم بهوية البراند.
سياق البراند:\n${brandStr}\nالذاكرة:\n${memStr}`,

  strategy_planner: (brandStr: string, memStr: string) =>
    `أنت Strategy & Planner Agent. مهمتك بناء خطة محتوى أسبوعية/شهرية مبنية على البراند والجمهور.
حدد محاور، مواضيع، منصات، وأوقات مقترحة. اجعل الخطة قابلة للتنفيذ.
سياق البراند:\n${brandStr}\nالذاكرة:\n${memStr}`,

  quality_engine: () =>
    `أنت Quality Engine Agent. قيّم المحتوى وفق معايير: Brand Fit, Audience Fit, Hook, Value, Clarity, Originality, Naturalness, Platform Fit, CTA, Language, Factual Safety.
أعطِ درجة (0-100) لكل معيار، وحدد الحكم: pass / review / fail، واذكر الأسباب.
أنت تحلل فقط — لا توافق بنفسك. القرار النهائي للمستخدم.`,

  analytics_advisor: (brandStr: string) =>
    `أنت Analytics & Growth Advisor. حلل الأداء واقترح قرارات عملية، وليس مجرد أرقام.
سياق البراند:\n${brandStr}`,

  idea_generator: (brandStr: string) =>
    `أنت Idea Generator Agent. اقترح أفكار محتوى إبداعية ومتنوعة تناسب البراند.
سياق البراند:\n${brandStr}`,
};

// ---------------------------------------------------------------------------
// Orchestrator — decides which agents to run per intent
// ---------------------------------------------------------------------------

function planAgents(intent: Intent): string[] {
  switch (intent) {
    case 'generate_brand_dna':
      return ['brand_intelligence'];
    case 'create_content':
      return ['content_creator', 'quality_engine'];
    case 'create_content_plan':
      return ['strategy_planner'];
    case 'analyze_performance':
      return ['analytics_advisor'];
    case 'suggest_ideas':
      return ['idea_generator'];
    case 'general_advice':
      return ['analytics_advisor'];
    default:
      return ['analytics_advisor'];
  }
}

// ---------------------------------------------------------------------------
// Intent execution
// ---------------------------------------------------------------------------

async function executeIntent(
  intent: Intent,
  message: string,
  ctx: { brand: Record<string, unknown> | null; memory: { key: string; value: string; type: string }[] },
  platforms: string[],
  model: string
): Promise<{ result: Record<string, unknown>; tokensIn: number; tokensOut: number }> {
  const brandStr = brandContextString(ctx.brand);
  const memStr = memoryContextString(ctx.memory);

  switch (intent) {
    case 'generate_brand_dna': {
      const sys = AGENTS.brand_intelligence(message);
      const prompt = `بناءً على هذه المعلومات الأساسية، ابنِ هوية براند كاملة بصيغة JSON تحتوي على مفاتيح:
identity, tone, audience, content, visual, platforms, summary.
المعلومات الأساسية: ${message}
أرجع JSON فقط بدون نص إضافي.`;
      const { content, tokensIn, tokensOut } = await callLLM(sys, prompt, model, true);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : { summary: content };
      }
      return { result: parsed, tokensIn, tokensOut };
    }

    case 'create_content': {
      const plats = platforms.length > 0 ? platforms.join(', ') : 'لينكدإن, فيسبوك, إنستجرام';
      const sys = AGENTS.content_creator(brandStr, memStr);
      const prompt = `اكتب محتوى للطلب التالي: "${message}"
المنصات المطلوبة: ${plats}
أرجع JSON بصيغة:
{
  "title": "...",
  "goal": "...",
  "topic": "...",
  "audience": "...",
  "master_text": "...",
  "platforms": ["linkedin", "facebook"],
  "variants": [
    { "platform": "linkedin", "text": "...", "hashtags": ["..."], "cta": "...", "media_brief": {} }
  ]
}
أرجع JSON فقط. كل نسخة منصة يجب أن تكون مخصصة وغير مكررة.`;
      const { content, tokensIn, tokensOut } = await callLLM(sys, prompt, model, true);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : { master_text: content, variants: [] };
      }
      return { result: parsed, tokensIn, tokensOut };
    }

    case 'create_content_plan': {
      const sys = AGENTS.strategy_planner(brandStr, memStr);
      const prompt = `الطلب: "${message}"
ابنِ خطة محتوى بصيغة JSON:
{
  "theme": "...",
  "slots": [
    { "date": "YYYY-MM-DD", "platform": "linkedin", "title": "..." }
  ]
}
اقترح 5-7 فترات. أرجع JSON فقط.`;
      const { content, tokensIn, tokensOut } = await callLLM(sys, prompt, model, true);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        const match = content.match(/\{[\s\S]*\}/);
        parsed = match ? JSON.parse(match[0]) : { theme: message, slots: [] };
      }
      return { result: parsed, tokensIn, tokensOut };
    }

    case 'analyze_performance': {
      const sys = AGENTS.analytics_advisor(brandStr);
      const prompt = `الطلب: "${message}"
حلل الأداء واقترح قرارات عملية بصيغة JSON: { "advice": "..." }`;
      const { content, tokensIn, tokensOut } = await callLLM(sys, prompt, model, true);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { advice: content };
      }
      return { result: parsed, tokensIn, tokensOut };
    }

    case 'suggest_ideas': {
      const sys = AGENTS.idea_generator(brandStr);
      const prompt = `الطلب: "${message}"
اقترح أفكار محتوى بصيغة JSON: { "advice": "..." }`;
      const { content, tokensIn, tokensOut } = await callLLM(sys, prompt, model, true);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { advice: content };
      }
      return { result: parsed, tokensIn, tokensOut };
    }

    case 'general_advice':
    default: {
      const sys = AGENTS.analytics_advisor(brandStr);
      const prompt = `سؤال المستخدم: "${message}"
أجب بنصيحة عملية ومختصرة بصيغة JSON: { "advice": "..." }`;
      const { content, tokensIn, tokensOut } = await callLLM(sys, prompt, model, true);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = { advice: content };
      }
      return { result: parsed, tokensIn, tokensOut };
    }
  }
}

// ---------------------------------------------------------------------------
// Cost estimation (rough)
// ---------------------------------------------------------------------------

const COST_PER_1K: Record<string, { in: number; out: number }> = {
  'gpt-4o': { in: 0.005, out: 0.015 },
  'gpt-4o-mini': { in: 0.00015, out: 0.0006 },
};

function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const rate = COST_PER_1K[model] ?? COST_PER_1K['gpt-4o-mini'];
  return (tokensIn / 1000) * rate.in + (tokensOut / 1000) * rate.out;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RequestBody;
    const { intent, workspaceId, message, platforms } = body;

    if (!intent || !workspaceId || !message) {
      return jsonError(400, 'intent, workspaceId, and message are required');
    }

    // --- Authorization: verify user identity + workspace membership ---
    const auth = await authorize(req, workspaceId);
    if (!auth.ok) return auth.response;
    const userId = auth.userId;

    const started = Date.now();
    const { model, provider } = pickModel(intent);
    const agents = planAgents(intent);

    // Create AI run record
    const { data: run } = await supabase
      .from('ai_runs')
      .insert({
        workspace_id: workspaceId,
        user_id: userId,
        task: intent,
        intent: message.slice(0, 200),
        agents,
        model,
        provider,
        status: 'running',
      })
      .select()
      .single();

    const runId = run?.id ?? crypto.randomUUID();

    try {
      const ctx = await assembleContext(workspaceId, intent);
      const plats = platforms ?? [];
      const { result, tokensIn, tokensOut } = await executeIntent(
        intent,
        message,
        ctx,
        plats,
        model
      );
      const latencyMs = Date.now() - started;
      const cost = estimateCost(model, tokensIn, tokensOut);

      await supabase.from('ai_runs').update({
        status: 'succeeded',
        input_tokens: tokensIn,
        output_tokens: tokensOut,
        cost_usd: cost,
        latency_ms: latencyMs,
        result,
      }).eq('id', runId);

      return new Response(
        JSON.stringify({
          runId,
          agents,
          model,
          provider,
          latencyMs,
          result,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (err) {
      const latencyMs = Date.now() - started;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      await supabase.from('ai_runs').update({
        status: 'failed',
        error: errMsg,
        latency_ms: latencyMs,
      }).eq('id', runId);

      return new Response(
        JSON.stringify({ error: errMsg }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Internal error';
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
