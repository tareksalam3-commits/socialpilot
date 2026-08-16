import { useState, type ReactNode } from 'react';
import { Sparkles, ArrowLeft, Check, Brain, Target, Users, Globe } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { callAiGateway } from '@/lib/api';
import { Button, Card, ErrorBanner, Spinner } from '@/components/ui';
import type { GeneratedBrandDna } from '@/lib/types';

export function BrandBrainOnboarding() {
  const { workspace, refreshWorkspace } = useAuth();
  const [step, setStep] = useState<'form' | 'generating' | 'review' | 'saved'>('form');
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [website, setWebsite] = useState('');
  const [audience, setAudience] = useState('');
  const [goal, setGoal] = useState('');

  const [generated, setGenerated] = useState<GeneratedBrandDna | null>(null);

  async function handleGenerate() {
    if (!workspace) return;
    setError(null);
    setStep('generating');

    const basics = `اسم البراند: ${name}\nماذا يقدم: ${description}\nالموقع: ${website || 'غير محدد'}\nالجمهور: ${audience}\nالهدف: ${goal}`;

    try {
      // Save draft brand DNA basics first
      await supabase.from('brand_dna').upsert({
        workspace_id: workspace.id,
        status: 'draft',
        basics: { name, description, website, audience, goal },
      });

      const res = await callAiGateway({
        intent: 'generate_brand_dna',
        workspaceId: workspace.id,
        message: basics,
      });

      setGenerated(res.result as GeneratedBrandDna);
      setStep('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل توليد هوية البراند');
      setStep('form');
    }
  }

  async function handleConfirm() {
    if (!workspace || !generated) return;
    setError(null);

    try {
      await supabase.from('brand_dna').update({
        status: 'confirmed',
        identity: generated.identity,
        tone: generated.tone,
        audience: generated.audience,
        content: generated.content,
        visual: generated.visual,
        positioning: generated.positioning ?? null,
        preferred_phrases: generated.preferred_phrases ?? [],
        forbidden_phrases: generated.forbidden_phrases ?? [],
        cta_style: generated.cta_style ?? null,
        platforms: generated.platforms ?? [],
      }).eq('workspace_id', workspace.id);

      // Seed initial brand memory from the generated identity
      const memoryEntries = [
        { type: 'decision' as const, key: 'brand_positioning', value: generated.summary ?? 'تم تأكيد هوية البراند', confidence: 0.8 },
        { type: 'preference' as const, key: 'tone', value: JSON.stringify(generated.tone), confidence: 0.7 },
        { type: 'preference' as const, key: 'audience', value: JSON.stringify(generated.audience), confidence: 0.7 },
      ];
      await supabase.from('brand_memory').insert(
        memoryEntries.map((m) => ({ ...m, workspace_id: workspace.id, source: 'brand_brain_init' }))
      );

      setStep('saved');
      setTimeout(() => refreshWorkspace(), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حفظ هوية البراند');
    }
  }

  if (step === 'generating') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-4">
        <div className="w-20 h-20 rounded-3xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center">
          <Brain className="text-brand-400 animate-pulse" size={40} />
        </div>
        <p className="text-ink-100 font-medium text-lg">يهيّل البراند...</p>
        <p className="text-ink-500 text-sm text-center max-w-xs">
          النظام يحلل المعلومات ويبني هوية كاملة لبراندك — الهوية، النبرة، الجمهور، محاور المحتوى
        </p>
        <Spinner className="text-brand-400 mt-2" />
      </div>
    );
  }

  if (step === 'review' && generated) {
    return (
      <div className="min-h-screen px-5 py-6 safe-top">
        <div className="flex items-center gap-2 mb-6">
          <button onClick={() => setStep('form')} className="p-2 -mr-2 text-ink-400 hover:text-ink-100">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-lg font-bold text-ink-50">ده اللي فهمته عن البراند</h1>
        </div>

        <p className="text-ink-400 text-sm mb-5">{generated.summary}</p>

        <div className="flex flex-col gap-4 mb-6">
          <ReviewSection title="الهوية" data={generated.identity} />
          <ReviewSection title="النبرة والصوت" data={generated.tone} />
          <ReviewSection title="الجمهور" data={generated.audience} />
          <ReviewSection title="محاور المحتوى" data={generated.content} />
          <ReviewSection title="الهوية البصرية" data={generated.visual} />
          {generated.positioning && <ReviewSection title="التموضع" data={{ positioning: generated.positioning }} />}
          {(generated.preferred_phrases?.length ?? 0) > 0 && <ReviewSection title="عبارات مفضلة" data={{ preferred_phrases: generated.preferred_phrases }} />}
          {(generated.forbidden_phrases?.length ?? 0) > 0 && <ReviewSection title="عبارات ممنوعة" data={{ forbidden_phrases: generated.forbidden_phrases }} />}
          {generated.cta_style && <ReviewSection title="أسلوب الدعوة للإجراء" data={{ cta_style: generated.cta_style }} />}
          {generated.platforms && generated.platforms.length > 0 && (
            <Card>
              <p className="text-ink-400 text-xs mb-2">المنصات المفضلة</p>
              <div className="flex flex-wrap gap-2">
                {generated.platforms.map((p: string) => (
                  <span key={p} className="px-3 py-1 rounded-lg bg-brand-500/15 text-brand-300 text-sm">
                    {p}
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>

        {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setStep('form')} className="flex-1">
            تعديل المعلومات
          </Button>
          <Button onClick={handleConfirm} className="flex-1">
            <span className="flex items-center justify-center gap-2">
              <Check size={18} />
              تأكيد الهوية
            </span>
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'saved') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen px-6 gap-4 animate-scale-in">
        <div className="w-20 h-20 rounded-3xl bg-brand-500 flex items-center justify-center">
          <Check className="text-ink-950" size={40} />
        </div>
        <p className="text-ink-100 font-bold text-xl">تم بناء هوية البراند!</p>
        <p className="text-ink-400 text-sm text-center max-w-xs">
          أصبحت Brand DNA جاهزة. النظام الآن يفهم براندك ويقدر يبدأ في إنشاء المحتوى.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-5 py-6 safe-top">
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 rounded-2xl bg-brand-500/15 border border-brand-500/30 flex items-center justify-center mb-3">
          <Sparkles className="text-brand-400" size={28} />
        </div>
        <h1 className="text-xl font-bold text-ink-50">بناء عقل البراند</h1>
        <p className="text-ink-400 text-sm mt-2 text-center max-w-xs">
          أدخل معلومات أساسية والذكاء الاصطناعي يبني هوية كاملة لبراندك
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <Field icon={<Brain size={18} />} label="اسم البراند" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثال: شركة التأمين الذكي"
            className="field-input"
          />
        </Field>

        <Field icon={<Sparkles size={18} />} label="ماذا يقدم البراند؟" required>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="مثال: خدمات تأمين رقمية للأفراد والشركات"
            rows={3}
            className="field-input resize-none"
          />
        </Field>

        <Field icon={<Globe size={18} />} label="الموقع الإلكتروني (اختياري)">
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="example.com"
            className="field-input"
            dir="ltr"
          />
        </Field>

        <Field icon={<Users size={18} />} label="الجمهور المستهدف" required>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="مثال: الشباب من 25-40 عامًا، أصحاب الأعمال الصغيرة"
            className="field-input"
          />
        </Field>

        <Field icon={<Target size={18} />} label="الهدف من المحتوى" required>
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="مثال: زيادة الوعي بالعلامة وجذب عملاء جدد"
            className="field-input"
          />
        </Field>

        {error && <ErrorBanner message={error} />}

        <Button onClick={handleGenerate} size="lg" disabled={!name || !description || !audience || !goal}>
          بناء هوية البراند
        </Button>
      </div>

      <style>{`
        .field-input {
          width: 100%;
          background: #18181b;
          border: 1px solid #27272a;
          border-radius: 0.75rem;
          padding: 0.75rem 1rem;
          color: #f4f4f5;
          font-size: 0.875rem;
        }
        .field-input::placeholder { color: #52525b; }
        .field-input:focus { border-color: rgba(16,185,129,0.4); outline: none; }
      `}</style>
    </div>
  );
}

function Field({
  icon,
  label,
  required,
  children,
}: {
  icon: ReactNode;
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-ink-300 text-sm mb-1.5">
        <span className="text-ink-500">{icon}</span>
        {label}
        {required && <span className="text-danger-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function ReviewSection({ title, data }: { title: string; data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return null;
  return (
    <Card className="animate-slide-up">
      <p className="text-ink-400 text-xs mb-3">{title}</p>
      <div className="flex flex-col gap-2">
        {entries.map(([key, value]) => (
          <div key={key} className="flex flex-col gap-0.5">
            <span className="text-ink-500 text-xs">{formatKey(key)}</span>
            <span className="text-ink-100 text-sm">
              {formatValue(value)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function formatKey(key: string): string {
  const map: Record<string, string> = {
    name: 'الاسم',
    description: 'الوصف',
    positioning: 'التموضع',
    values: 'القيم',
    differentiators: 'نقاط التميّز',
    voice: 'الصوت',
    tone: 'النبرة',
    personas: 'الشخصيات',
    pillars: 'محاور المحتوى',
    preferred_topics: 'المواضيع المفضلة',
    forbidden_topics: 'مواضيع ممنوعة',
    cta_style: 'أسلوب الدعوة للإجراء',
    preferred_phrases: 'عبارات مفضلة',
    forbidden_phrases: 'عبارات ممنوعة',
    vocabulary: 'المفردات',
    writing_style: 'أسلوب الكتابة',
    visual_style: 'الأسلوب البصري',
    colors: 'الألوان',
    demographics: 'الديموغرافيا',
    interests: 'الاهتمامات',
    pain_points: 'نقاط الألم',
    platforms: 'المنصات',
    primary: 'الأساسي',
    secondary: 'الثانوي',
  };
  return map[key] ?? key.replace(/_/g, ' ');
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join('، ');
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${formatKey(k)}: ${formatValue(v)}`)
      .join(' | ');
  }
  return String(value);
}
