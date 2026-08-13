import { type ReactNode, useEffect, useState } from 'react';
import { AlertCircle, Brain, CheckCircle2, Clock3, Save, Sparkles, X } from 'lucide-react';
import { useBrandVoice } from '@/hooks/useBrandVoice';
import { useAudienceProfile } from '@/hooks/useAudienceProfile';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Button, Card, Input, Skeleton } from '@/ui';

export function BrandVoicePage() {
  const { t } = useLanguage();
  const { brandVoice, loading, update } = useBrandVoice();
  const { audienceProfile, loading: audienceLoading, reload: reloadAudience } = useAudienceProfile();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    business_name: '',
    description: '',
    industry: '',
    writing_style: 'professional',
    tone: 'professional',
    cta_style: 'clear',
    emoji_style: 'minimal',
    // Brand DNA — Phase 2, STEP 3 (section 6/7). Free text unless the
    // migration comment suggests a closed set of values (formality,
    // sentence_style, content_length), same split as the original fields
    // above (select) vs. audience/description (free text).
    formality: 'neutral',
    voice: '',
    sentence_style: 'mixed',
    hook_style: '',
    hashtag_policy: '',
    content_length: 'medium',
    audience_relationship: '',
  });
  const [keywords, setKeywords] = useState<string[]>([]);
  const [negativeKeywords, setNegativeKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState('');
  const [negKeywordInput, setNegKeywordInput] = useState('');
  const [brandValues, setBrandValues] = useState<string[]>([]);
  const [brandValueInput, setBrandValueInput] = useState('');

  // sync form when brandVoice loads
  const [synced, setSynced] = useState(false);
  if (brandVoice && !synced) {
    setForm({
      business_name: brandVoice.business_name ?? '',
      description: brandVoice.description ?? '',
      industry: brandVoice.industry ?? '',
      writing_style: brandVoice.writing_style ?? 'professional',
      tone: brandVoice.tone ?? 'professional',
      cta_style: brandVoice.cta_style ?? 'clear',
      emoji_style: brandVoice.emoji_style ?? 'minimal',
      formality: brandVoice.formality ?? 'neutral',
      voice: brandVoice.voice ?? '',
      sentence_style: brandVoice.sentence_style ?? 'mixed',
      hook_style: brandVoice.hook_style ?? '',
      hashtag_policy: brandVoice.hashtag_policy ?? '',
      content_length: brandVoice.content_length ?? 'medium',
      audience_relationship: brandVoice.audience_relationship ?? '',
    });
    setKeywords(brandVoice.keywords ?? []);
    setNegativeKeywords(brandVoice.negative_keywords ?? []);
    setBrandValues(brandVoice.brand_values ?? []);
    setSynced(true);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await update({
        business_name: form.business_name || null,
        description: form.description || null,
        industry: form.industry || null,
        writing_style: form.writing_style,
        tone: form.tone,
        cta_style: form.cta_style,
        emoji_style: form.emoji_style,
        keywords,
        negative_keywords: negativeKeywords,
        formality: form.formality || null,
        voice: form.voice || null,
        sentence_style: form.sentence_style || null,
        hook_style: form.hook_style || null,
        hashtag_policy: form.hashtag_policy || null,
        content_length: form.content_length || null,
        audience_relationship: form.audience_relationship || null,
        brand_values: brandValues,
      });
      await reloadAudience();
      push({ title: t('ai.brandVoice.toast.saved'), description: t('ai.brandVoice.toast.savedDesc'), variant: 'success' });
    } catch (e) {
      push({ title: t('ai.brandVoice.toast.saveFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // The profile is authored by the background intelligence worker. Poll only
  // while it is queued or analyzing so the UI reflects a completed inference
  // shortly after a Brand Voice save, without any manual audience form.
  useEffect(() => {
    const status = audienceProfile?.inference_status;
    if (!status || !['idle', 'queued', 'analyzing'].includes(status)) return;
    const interval = window.setInterval(() => { void reloadAudience(); }, 10_000);
    return () => window.clearInterval(interval);
  }, [audienceProfile?.inference_status, reloadAudience]);

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
  const addBrandValue = () => {
    if (brandValueInput.trim() && !brandValues.includes(brandValueInput.trim())) {
      setBrandValues([...brandValues, brandValueInput.trim()]);
      setBrandValueInput('');
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

      <Card title={t('ai.brandVoice.audienceIntelligence.title')} description={t('ai.brandVoice.audienceIntelligence.description')}>
        <AutomaticAudienceProfile audienceProfile={audienceProfile} loading={audienceLoading} t={t} />
      </Card>

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

        {/* Brand DNA — Phase 2, STEP 3 (section 6/7). Everything an AI
            content task can pull via WorkspaceContext.brand beyond the
            original brand_voice columns above. */}
        <Card title={t('ai.brandVoice.dna.title')} description={t('ai.brandVoice.dna.description')}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.brandVoice.dna.formality')}</label>
                <select
                  value={form.formality}
                  onChange={(e) => setForm({ ...form, formality: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {['casual', 'neutral', 'formal'].map((s) => (
                    <option key={s} value={s}>{t(`options.${s}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.brandVoice.dna.sentenceStyle')}</label>
                <select
                  value={form.sentence_style}
                  onChange={(e) => setForm({ ...form, sentence_style: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                >
                  {['short_punchy', 'flowing', 'mixed'].map((s) => (
                    <option key={s} value={s}>{t(`options.${s}`)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.brandVoice.dna.contentLength')}</label>
              <select
                value={form.content_length}
                onChange={(e) => setForm({ ...form, content_length: e.target.value })}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {['short', 'medium', 'long'].map((s) => (
                  <option key={s} value={s}>{t(`options.${s}`)}</option>
                ))}
              </select>
            </div>
            <Input label={t('ai.brandVoice.dna.voice')} value={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.value })} placeholder={t('ai.brandVoice.dna.voicePlaceholder')} />
            <Input label={t('ai.brandVoice.dna.hookStyle')} value={form.hook_style} onChange={(e) => setForm({ ...form, hook_style: e.target.value })} placeholder={t('ai.brandVoice.dna.hookStylePlaceholder')} />
            <Input label={t('ai.brandVoice.dna.hashtagPolicy')} value={form.hashtag_policy} onChange={(e) => setForm({ ...form, hashtag_policy: e.target.value })} placeholder={t('ai.brandVoice.dna.hashtagPolicyPlaceholder')} />
            <Input label={t('ai.brandVoice.dna.audienceRelationship')} value={form.audience_relationship} onChange={(e) => setForm({ ...form, audience_relationship: e.target.value })} placeholder={t('ai.brandVoice.dna.audienceRelationshipPlaceholder')} />
          </div>
        </Card>

        <Card title={t('ai.brandVoice.dna.values.title')}>
          <div className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('ai.brandVoice.dna.values.description')}</p>
            <div className="flex gap-2">
              <Input value={brandValueInput} onChange={(e) => setBrandValueInput(e.target.value)} placeholder={t('ai.brandVoice.dna.values.placeholder')} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addBrandValue())} />
              <Button variant="outline" onClick={addBrandValue}>{t('ai.brandVoice.keywords.addButton')}</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {brandValues.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-xs text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                  {v}
                  <button onClick={() => setBrandValues(brandValues.filter((x) => x !== v))}><X className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function AutomaticAudienceProfile({
  audienceProfile,
  loading,
  t,
}: {
  audienceProfile: ReturnType<typeof useAudienceProfile>['audienceProfile'];
  loading: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  if (loading) return <Skeleton className="h-32 w-full" />;

  const status = audienceProfile?.inference_status ?? 'idle';
  const isPending = status === 'idle' || status === 'queued' || status === 'analyzing';
  const sourceCount = audienceProfile?.inference_sources?.active_learning_count ?? 0;
  const inferenceTime = audienceProfile?.inferred_at
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(audienceProfile.inferred_at))
    : null;

  if (status === 'needs_brand_context') {
    return <AudienceNotice icon={<Brain className="h-5 w-5" />} tone="sky" text={t('ai.brandVoice.audienceIntelligence.needsContext')} />;
  }
  if (status === 'failed') {
    return <AudienceNotice icon={<AlertCircle className="h-5 w-5" />} tone="rose" text={t('ai.brandVoice.audienceIntelligence.failed')} />;
  }
  if (isPending && !audienceProfile?.persona) {
    return <AudienceNotice icon={<Clock3 className="h-5 w-5 animate-pulse" />} tone="amber" text={t('ai.brandVoice.audienceIntelligence.pending')} />;
  }
  if (!audienceProfile?.persona) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">{t('ai.brandVoice.audienceIntelligence.noData')}</p>;
  }

  return (
    <div className="space-y-5">
      {isPending && <AudienceNotice icon={<Clock3 className="h-4 w-4 animate-pulse" />} tone="amber" text={t('ai.brandVoice.audienceIntelligence.pending')} compact />}
      <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-4 dark:border-violet-900 dark:bg-violet-950/30">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-violet-900 dark:text-violet-200">
          <Brain className="h-4 w-4" /> {t('ai.brandVoice.audienceIntelligence.persona')}
        </div>
        <p className="text-sm leading-6 text-slate-700 dark:text-slate-200">{audienceProfile.persona}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AudienceSignals title={t('ai.brandVoice.audienceIntelligence.painPoints')} items={audienceProfile.pain_points} tone="rose" />
        <AudienceSignals title={t('ai.brandVoice.audienceIntelligence.desires')} items={audienceProfile.desires} tone="emerald" />
        <AudienceSignals title={t('ai.brandVoice.audienceIntelligence.motivations')} items={audienceProfile.motivations} tone="amber" />
        <AudienceSignals title={t('ai.brandVoice.audienceIntelligence.objections')} items={audienceProfile.objections} tone="slate" />
        <AudienceSignals title={t('ai.brandVoice.audienceIntelligence.interests')} items={audienceProfile.interests} tone="sky" />
        <AudienceSignals title={t('ai.brandVoice.audienceIntelligence.preferredContent')} items={audienceProfile.preferred_content} tone="violet" />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />{t('ai.brandVoice.audienceIntelligence.sources', { learnings: sourceCount })}</span>
        {inferenceTime && <span>{t('ai.brandVoice.audienceIntelligence.updated')}: {inferenceTime}</span>}
      </div>
    </div>
  );
}

function AudienceNotice({ icon, tone, text, compact = false }: { icon: ReactNode; tone: 'sky' | 'amber' | 'rose'; text: string; compact?: boolean }) {
  const tones = {
    sky: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
    rose: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
  };
  return <div className={`flex items-center gap-2 rounded-lg border ${tones[tone]} ${compact ? 'px-3 py-2 text-xs' : 'p-4 text-sm'}`}>{icon}<span>{text}</span></div>;
}

function AudienceSignals({ title, items, tone }: { title: string; items: string[]; tone: 'rose' | 'emerald' | 'amber' | 'slate' | 'sky' | 'violet' }) {
  if (!items.length) return null;
  const tones = {
    rose: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
    emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    sky: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  };
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => <span key={item} className={`rounded-full px-2.5 py-1 text-xs ${tones[tone]}`}>{item}</span>)}
      </div>
    </div>
  );
}
