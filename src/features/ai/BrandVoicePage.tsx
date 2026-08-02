import { useState } from 'react';
import { Save, Sparkles, X } from 'lucide-react';
import { useBrandVoice } from '@/hooks/useBrandVoice';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Button, Card, Input, Skeleton } from '@/ui';

export function BrandVoicePage() {
  const { t } = useLanguage();
  const { brandVoice, loading, update } = useBrandVoice();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    business_name: '',
    description: '',
    audience: '',
    industry: '',
    writing_style: 'professional',
    tone: 'professional',
    cta_style: 'clear',
    emoji_style: 'minimal',
  });
  const [keywords, setKeywords] = useState<string[]>([]);
  const [negativeKeywords, setNegativeKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [negKeywordInput, setNegKeywordInput] = useState('');

  // sync form when brandVoice loads
  const [synced, setSynced] = useState(false);
  if (brandVoice && !synced) {
    setForm({
      business_name: brandVoice.business_name ?? '',
      description: brandVoice.description ?? '',
      audience: brandVoice.audience ?? '',
      industry: brandVoice.industry ?? '',
      writing_style: brandVoice.writing_style ?? 'professional',
      tone: brandVoice.tone ?? 'professional',
      cta_style: brandVoice.cta_style ?? 'clear',
      emoji_style: brandVoice.emoji_style ?? 'minimal',
    });
    setKeywords(brandVoice.keywords ?? []);
    setNegativeKeywords(brandVoice.negative_keywords ?? []);
    setSynced(true);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await update({
        business_name: form.business_name || null,
        description: form.description || null,
        audience: form.audience || null,
        industry: form.industry || null,
        writing_style: form.writing_style,
        tone: form.tone,
        cta_style: form.cta_style,
        emoji_style: form.emoji_style,
        keywords,
        negative_keywords: negativeKeywords,
      });
      push({ title: t('ai.brandVoice.toast.saved'), description: t('ai.brandVoice.toast.savedDesc'), variant: 'success' });
    } catch (e) {
      push({ title: t('ai.brandVoice.toast.saveFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const addKeyword = () => {
    if (keywordInput.trim() && !keywords.includes(keywordInput.trim())) {
      setKeywords([...keywords, keywordInput.trim()]);
      setKeywordInput('');
    }
  };
  const addNegKeyword = () => {
    if (negKeywordInput.trim() && !negativeKeywords.includes(negKeywordInput.trim())) {
      setNegativeKeywords([...negativeKeywords, negKeywordInput.trim()]);
      setNegKeywordInput('');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <div className="rounded-xl border border-slate-200 p-5 dark:border-slate-800">
          <Skeleton className="mb-4 h-4 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.brandVoice.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {t('ai.brandVoice.subtitle')}
          </p>
        </div>
        <Button onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4" /> {t('ai.brandVoice.saveButton')}
        </Button>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/50">
        <p className="flex items-center gap-2 text-sm text-sky-800 dark:text-sky-300">
          <Sparkles className="h-4 w-4" />
          {t('ai.brandVoice.banner')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={t('ai.brandVoice.identity.title')}>
          <div className="space-y-4">
            <Input label={t('ai.brandVoice.identity.businessName')} value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} placeholder={t('ai.brandVoice.identity.businessNamePlaceholder')} />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.brandVoice.identity.description')}</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                placeholder={t('ai.brandVoice.identity.descriptionPlaceholder')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <Input label={t('ai.brandVoice.identity.industry')} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder={t('ai.brandVoice.identity.industryPlaceholder')} />
            <Input label={t('ai.brandVoice.identity.audience')} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder={t('ai.brandVoice.identity.audiencePlaceholder')} />
          </div>
        </Card>

        <Card title={t('ai.brandVoice.voice.title')}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.brandVoice.voice.writingStyle')}</label>
                <select
                  value={form.writing_style}
                  onChange={(e) => setForm({ ...form, writing_style: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {['professional', 'casual', 'technical', 'conversational', 'formal'].map((s) => (
                    <option key={s} value={s}>{t(`options.${s}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.brandVoice.voice.tone')}</label>
                <select
                  value={form.tone}
                  onChange={(e) => setForm({ ...form, tone: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {['professional', 'friendly', 'authoritative', 'playful', 'empathetic', 'urgent'].map((s) => (
                    <option key={s} value={s}>{t(`options.${s}`)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.brandVoice.voice.ctaStyle')}</label>
                <select
                  value={form.cta_style}
                  onChange={(e) => setForm({ ...form, cta_style: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {['clear', 'urgent', 'soft', 'question', 'bold'].map((s) => (
                    <option key={s} value={s}>{t(`options.${s}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.brandVoice.voice.emojiStyle')}</label>
                <select
                  value={form.emoji_style}
                  onChange={(e) => setForm({ ...form, emoji_style: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {['none', 'minimal', 'moderate', 'heavy'].map((s) => (
                    <option key={s} value={s}>{t(`options.${s}`)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </Card>

        <Card title={t('ai.brandVoice.keywords.title')}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('ai.brandVoice.keywords.description')}</p>
            <div className="flex gap-2">
              <Input value={keywordInput} onChange={(e) => setKeywordInput(e.target.value)} placeholder={t('ai.brandVoice.keywords.placeholder')} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())} />
              <Button variant="outline" onClick={addKeyword}>{t('ai.brandVoice.keywords.addButton')}</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {keywords.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {k}
                  <button onClick={() => setKeywords(keywords.filter((x) => x !== k))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          </div>
        </Card>

        <Card title={t('ai.brandVoice.negKeywords.title')}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('ai.brandVoice.negKeywords.description')}</p>
            <div className="flex gap-2">
              <Input value={negKeywordInput} onChange={(e) => setNegKeywordInput(e.target.value)} placeholder={t('ai.brandVoice.negKeywords.placeholder')} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addNegKeyword())} />
              <Button variant="outline" onClick={addNegKeyword}>{t('ai.brandVoice.keywords.addButton')}</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {negativeKeywords.map((k) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                  {k}
                  <button onClick={() => setNegativeKeywords(negativeKeywords.filter((x) => x !== k))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
