import { useState, useRef, useEffect } from 'react';
import { Sparkles, Send, Copy, Check, FileText, Calendar, BarChart3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { callAiGateway } from '@/lib/api';
import { Button, Card, ErrorBanner, Spinner, Badge } from '@/components/ui';
import { PLATFORM_META } from '@/lib/constants';
import type { GeneratedContent, ContentPlan } from '@/lib/types';

type Mode = 'idle' | 'thinking' | 'content' | 'plan' | 'advice' | 'error';

type ChatTurn = { role: 'user' | 'ai'; text: string };

const SUGGESTIONS = [
  'اكتبلي بوست قوي عن التأمين',
  'اعملّي خطة محتوى للأسبوع الجاي',
  'اقترح عليّ 5 أفكار محتوى',
  'حلل أداء الصفحة وقولي أعمل إيه',
];

export function CreateScreen() {
  const { workspace } = useAuth();
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [plan, setPlan] = useState<ContentPlan | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chat, mode]);

  async function handleSubmit(text?: string) {
    const message = text ?? input;
    if (!message.trim() || !workspace) return;

    setInput('');
    setError(null);
    setContent(null);
    setPlan(null);
    setAdvice(null);
    setSaved(false);
    setChat((prev) => [...prev, { role: 'user', text: message }]);
    setMode('thinking');

    // Intent detection — the orchestrator on the server side handles detailed routing,
    // but we do lightweight classification here for UI mode selection.
    const intent = classifyIntent(message);

    try {
      const res = await callAiGateway({
        intent,
        workspaceId: workspace.id,
        message,
      });

      setChat((prev) => [...prev, { role: 'ai', text: summarizeResult(res.result, intent) }]);

      if (intent === 'create_content') {
        setContent(res.result as GeneratedContent);
        setMode('content');
      } else if (intent === 'create_content_plan') {
        setPlan(res.result as ContentPlan);
        setMode('plan');
      } else {
        const r = res.result as { advice?: string };
        setAdvice(r.advice ?? 'تم');
        setMode('advice');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل تنفيذ الطلب';
      setError(msg);
      setMode('error');
      setChat((prev) => [...prev, { role: 'ai', text: `خطأ: ${msg}` }]);
    }
  }

  async function saveContent() {
    if (!content || !workspace) return;
    setSaving(true);
    try {
      const { data: inserted } = await supabase
        .from('content')
        .insert({
          workspace_id: workspace.id,
          title: content.title,
          goal: content.goal,
          topic: content.topic,
          audience: content.audience,
          master_text: content.master_text,
          platforms: content.platforms,
          status: 'draft',
        })
        .select()
        .single();

      if (inserted && content.variants.length > 0) {
        await supabase.from('content_variants').insert(
          content.variants.map((v) => ({
            content_id: inserted.id,
            workspace_id: workspace.id,
            platform: v.platform,
            text: v.text,
            hashtags: v.hashtags,
            cta: v.cta,
            media_brief: v.media_brief,
          }))
        );
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حفظ المحتوى');
    } finally {
      setSaving(false);
    }
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex flex-col h-screen safe-top">
      {/* Header */}
      <div className="px-5 py-4 border-b border-ink-800 glass">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-brand-400" />
          <div>
            <h1 className="text-base font-bold text-ink-50">اسأل AI</h1>
            <p className="text-ink-500 text-xs">ماذا تريد أن تحقق؟</p>
          </div>
        </div>
      </div>

      {/* Chat + results */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto no-scrollbar px-5 py-4">
        {chat.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 animate-fade-in">
            <div className="w-16 h-16 rounded-2xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center mb-4">
              <Sparkles className="text-brand-400" size={32} />
            </div>
            <p className="text-ink-300 text-sm text-center max-w-xs mb-6">
              اكتب أي حاجة بالعربي أو بالمصري. النظام يفهم المقصود وينفذ المهمة.
            </p>
            <div className="flex flex-col gap-2 w-full">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSubmit(s)}
                  className="text-right px-4 py-3 rounded-xl bg-ink-900 border border-ink-800 text-ink-200 text-sm hover:border-brand-500/30 transition-colors active:scale-[0.98]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Chat messages */}
        <div className="flex flex-col gap-3 mb-4">
          {chat.map((turn, i) => (
            <div
              key={i}
              className={`flex ${turn.role === 'user' ? 'justify-start' : 'justify-end'}`}
            >
              <div
                className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm ${
                  turn.role === 'user'
                    ? 'bg-brand-500 text-ink-950 rounded-bl-md'
                    : 'bg-ink-800 text-ink-100 rounded-br-md'
                }`}
              >
                {turn.text}
              </div>
            </div>
          ))}
        </div>

        {mode === 'thinking' && (
          <div className="flex justify-end mb-4">
            <div className="bg-ink-800 rounded-2xl rounded-br-md px-4 py-3 flex items-center gap-2">
              <Spinner className="text-brand-400" size={16} />
              <span className="text-ink-400 text-sm">يفكر وينفذ...</span>
            </div>
          </div>
        )}

        {error && mode === 'error' && (
          <div className="mb-4">
            <ErrorBanner message={error} />
          </div>
        )}

        {/* Content result */}
        {content && mode === 'content' && (
          <div className="flex flex-col gap-3 animate-slide-up">
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <FileText size={16} className="text-brand-400" />
                <p className="text-ink-100 font-medium">{content.title}</p>
              </div>
              <p className="text-ink-400 text-sm">{content.master_text}</p>
            </Card>

            <p className="text-ink-500 text-xs px-1">نسخ المنصات ({content.variants.length})</p>
            {content.variants.map((v, i) => {
              const meta = PLATFORM_META[v.platform as keyof typeof PLATFORM_META];
              const Icon = meta?.icon;
              return (
                <Card key={i}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {Icon && <Icon size={16} style={{ color: meta.color }} />}
                      <span className="text-ink-200 text-sm font-medium">{meta?.label ?? v.platform}</span>
                    </div>
                    <button
                      onClick={() => copyText(v.text, `v${i}`)}
                      className="text-ink-500 hover:text-ink-200 transition-colors"
                    >
                      {copied === `v${i}` ? <Check size={16} className="text-brand-400" /> : <Copy size={16} />}
                    </button>
                  </div>
                  <p className="text-ink-100 text-sm whitespace-pre-wrap leading-relaxed">{v.text}</p>
                  {v.hashtags.length > 0 && (
                    <p className="text-accent-400 text-xs mt-2">{v.hashtags.join(' ')}</p>
                  )}
                  {v.cta && <p className="text-brand-400 text-xs mt-1">CTA: {v.cta}</p>}
                </Card>
              );
            })}

            {saved ? (
              <div className="flex items-center justify-center gap-2 py-3 text-brand-400">
                <Check size={18} /> <span className="text-sm">تم حفظ المحتوى</span>
              </div>
            ) : (
              <Button onClick={saveContent} disabled={saving} size="lg">
                {saving ? 'جارٍ الحفظ...' : 'حفظ في المحتوى'}
              </Button>
            )}
          </div>
        )}

        {/* Plan result */}
        {plan && mode === 'plan' && (
          <div className="flex flex-col gap-3 animate-slide-up">
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={16} className="text-brand-400" />
                <p className="text-ink-100 font-medium">خطة المحتوى: {plan.theme}</p>
              </div>
            </Card>
            {plan.slots.map((slot, i) => (
              <Card key={i}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-ink-100 text-sm">{slot.title}</p>
                    <p className="text-ink-500 text-xs mt-1">{slot.date}</p>
                  </div>
                  <Badge color="brand">{slot.platform}</Badge>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Advice result */}
        {advice && mode === 'advice' && (
          <Card className="animate-slide-up">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 size={16} className="text-accent-400" />
              <p className="text-ink-300 text-sm font-medium">النتيجة</p>
            </div>
            <p className="text-ink-100 text-sm leading-relaxed">{advice}</p>
          </Card>
        )}
      </div>

      {/* Command bar */}
      <div className="px-4 py-3 border-t border-ink-800 glass safe-bottom">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="اكتب طلبك بالعربي..."
            className="flex-1 bg-ink-900 border border-ink-800 rounded-xl px-4 py-2.5 text-ink-100 text-sm placeholder:text-ink-500 focus:border-brand-500/40 focus:outline-none"
          />
          <button
            onClick={() => handleSubmit()}
            disabled={!input.trim() || mode === 'thinking'}
            className="w-10 h-10 rounded-xl bg-brand-500 text-ink-950 flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function classifyIntent(message: string): 'create_content' | 'create_content_plan' | 'suggest_ideas' | 'analyze_performance' | 'general_advice' {
  const m = message.toLowerCase();
  if (/خطة|plan|جدول|الأسبوع|الشهر|schedule/.test(m)) return 'create_content_plan';
  if (/بوست|اكتب|محتوى|post|write|content/.test(m)) return 'create_content';
  if (/أفكار|اقترح|ideas|suggest/.test(m)) return 'suggest_ideas';
  if (/أداء|تحليل|analyze|performance|حلل/.test(m)) return 'analyze_performance';
  return 'general_advice';
}

function summarizeResult(result: Record<string, unknown>, intent: string): string {
  if (intent === 'create_content') {
    const c = result as GeneratedContent;
    return `تم إنشاء محتوى "${c.title}" مع ${c.variants?.length ?? 0} نسخ للمنصات.`;
  }
  if (intent === 'create_content_plan') {
    const p = result as ContentPlan;
    return `تم بناء خطة محتوى "${p.theme}" بـ ${p.slots?.length ?? 0} فترات.`;
  }
  const r = result as { advice?: string };
  return r.advice ?? 'تم';
}
