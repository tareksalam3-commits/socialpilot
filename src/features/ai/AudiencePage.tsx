import { useState } from 'react';
import { Save, Sparkles, X } from 'lucide-react';
import { useAudienceProfile } from '@/hooks/useAudienceProfile';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Button, Card, Input, Skeleton } from '@/ui';
import type { AwarenessLevel, PurchaseIntent } from '@/types/ai';

const AWARENESS_LEVELS: AwarenessLevel[] = ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'];
const PURCHASE_INTENTS: PurchaseIntent[] = ['low', 'medium', 'high'];

/** Same tag-input pattern as BrandVoicePage's keywords/negative keywords —
 * used here for the six array fields section 9 asks for (pain_points,
 * desires, motivations, objections, interests, preferred_content). */
function TagField({
  label,
  description,
  placeholder,
  values,
  onChange,
  tone,
}: {
  label: string;
  description?: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
  tone: 'sky' | 'emerald' | 'rose' | 'amber';
}) {
  const [input, setInput] = useState('');
  const add = () => {
    if (input.trim() && !values.includes(input.trim())) {
      onChange([...values, input.trim()]);
      setInput('');
    }
  };
  const toneClasses = {
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  }[tone];
  return (
    <Card title={label}>
      <div className="space-y-3">
        {description && <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        <div className="flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
          <Button variant="outline" onClick={add}>+</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {values.map((v) => (
            <span key={v} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs ${toneClasses}`}>
              {v}
              <button onClick={() => onChange(values.filter((x) => x !== v))}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

export function AudiencePage() {
  const { t } = useLanguage();
  const { audienceProfile, loading, update } = useAudienceProfile();
  const { push } = useToast();
  const [saving, setSaving] = useState(false);

  const [persona, setPersona] = useState('');
  const [languageStyle, setLanguageStyle] = useState('');
  const [awarenessLevel, setAwarenessLevel] = useState<AwarenessLevel | ''>('');
  const [purchaseIntent, setPurchaseIntent] = useState<PurchaseIntent | ''>('');
  const [painPoints, setPainPoints] = useState<string[]>([]);
  const [desires, setDesires] = useState<string[]>([]);
  const [motivations, setMotivations] = useState<string[]>([]);
  const [objections, setObjections] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [preferredContent, setPreferredContent] = useState<string[]>([]);

  const [synced, setSynced] = useState(false);
  if (audienceProfile && !synced) {
    setPersona(audienceProfile.persona ?? '');
    setLanguageStyle(audienceProfile.language_style ?? '');
    setAwarenessLevel(audienceProfile.awareness_level ?? '');
    setPurchaseIntent(audienceProfile.purchase_intent ?? '');
    setPainPoints(audienceProfile.pain_points ?? []);
    setDesires(audienceProfile.desires ?? []);
    setMotivations(audienceProfile.motivations ?? []);
    setObjections(audienceProfile.objections ?? []);
    setInterests(audienceProfile.interests ?? []);
    setPreferredContent(audienceProfile.preferred_content ?? []);
    setSynced(true);
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await update({
        persona: persona || null,
        language_style: languageStyle || null,
        awareness_level: awarenessLevel || null,
        purchase_intent: purchaseIntent || null,
        pain_points: painPoints,
        desires,
        motivations,
        objections,
        interests,
        preferred_content: preferredContent,
      });
      push({ title: t('ai.audience.toast.saved'), description: t('ai.audience.toast.savedDesc'), variant: 'success' });
    } catch (e) {
      push({ title: t('ai.audience.toast.saveFailed'), description: e instanceof Error ? e.message : '', variant: 'error' });
    } finally {
      setSaving(false);
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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.audience.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('ai.audience.subtitle')}</p>
        </div>
        <Button onClick={handleSave} loading={saving}>
          <Save className="h-4 w-4" /> {t('ai.audience.saveButton')}
        </Button>
      </div>

      <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/50">
        <p className="flex items-center gap-2 text-sm text-sky-800 dark:text-sky-300">
          <Sparkles className="h-4 w-4" />
          {t('ai.audience.banner')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title={t('ai.audience.persona.title')}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.audience.persona.description')}</label>
              <textarea
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                rows={4}
                placeholder={t('ai.audience.persona.placeholder')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <Input label={t('ai.audience.languageStyle')} value={languageStyle} onChange={(e) => setLanguageStyle(e.target.value)} placeholder={t('ai.audience.languageStylePlaceholder')} />
          </div>
        </Card>

        <Card title={t('ai.audience.signals.title')}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.audience.awarenessLevel')}</label>
              <select
                value={awarenessLevel}
                onChange={(e) => setAwarenessLevel(e.target.value as AwarenessLevel | '')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">{t('ai.audience.notSet')}</option>
                {AWARENESS_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>{t(`ai.audience.awareness.${lvl}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ai.audience.purchaseIntent')}</label>
              <select
                value={purchaseIntent}
                onChange={(e) => setPurchaseIntent(e.target.value as PurchaseIntent | '')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                <option value="">{t('ai.audience.notSet')}</option>
                {PURCHASE_INTENTS.map((lvl) => (
                  <option key={lvl} value={lvl}>{t(`ai.audience.intent.${lvl}`)}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        <TagField label={t('ai.audience.painPoints.title')} description={t('ai.audience.painPoints.description')} placeholder={t('ai.audience.painPoints.placeholder')} values={painPoints} onChange={setPainPoints} tone="rose" />
        <TagField label={t('ai.audience.desires.title')} description={t('ai.audience.desires.description')} placeholder={t('ai.audience.desires.placeholder')} values={desires} onChange={setDesires} tone="emerald" />
        <TagField label={t('ai.audience.motivations.title')} placeholder={t('ai.audience.motivations.placeholder')} values={motivations} onChange={setMotivations} tone="sky" />
        <TagField label={t('ai.audience.objections.title')} placeholder={t('ai.audience.objections.placeholder')} values={objections} onChange={setObjections} tone="rose" />
        <TagField label={t('ai.audience.interests.title')} placeholder={t('ai.audience.interests.placeholder')} values={interests} onChange={setInterests} tone="amber" />
        <TagField label={t('ai.audience.preferredContent.title')} placeholder={t('ai.audience.preferredContent.placeholder')} values={preferredContent} onChange={setPreferredContent} tone="sky" />
      </div>
    </div>
  );
}
