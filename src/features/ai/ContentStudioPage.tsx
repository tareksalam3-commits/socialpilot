import { useState } from 'react';
import {
  Copy,
  Download,
  Facebook,
  Hash,
  ImageIcon,
  Instagram,
  Linkedin,
  ListChecks,
  ListOrdered,
  Lightbulb,
  Megaphone,
  PencilLine,
  Plus,
  Repeat2,
  Scissors,
  Sparkles,
  Target,
  Type,
  Wand2,
  Zap,
} from 'lucide-react';
import { useAI } from '@/hooks/useAI';
import { useAISettings } from '@/hooks/useAISettings';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Button, Card, MarkdownRenderer, Badge, EmptyState } from '@/ui';

type ActionType =
  | 'generate'
  | 'rewrite'
  | 'expand'
  | 'shorten'
  | 'translate'
  | 'improve'
  | 'grammar'
  | 'professional'
  | 'friendly'
  | 'marketing'
  | 'sales'
  | 'storytelling';

type GeneratorType =
  | 'hooks'
  | 'cta'
  | 'hashtags'
  | 'carousel_outline'
  | 'carousel_slides'
  | 'reel_script'
  | 'video_script'
  | 'story_ideas'
  | 'poll_ideas'
  | 'monthly_calendar'
  | 'weekly_calendar'
  | 'content_ideas'
  | 'content_series';

const actions: { id: ActionType; labelKey: string; icon: typeof Wand2 }[] = [
  { id: 'generate', labelKey: 'ai.studio.action.generate', icon: Sparkles },
  { id: 'rewrite', labelKey: 'ai.studio.action.rewrite', icon: Repeat2 },
  { id: 'expand', labelKey: 'ai.studio.action.expand', icon: Plus },
  { id: 'shorten', labelKey: 'ai.studio.action.shorten', icon: Scissors },
  { id: 'translate', labelKey: 'ai.studio.action.translate', icon: Type },
  { id: 'improve', labelKey: 'ai.studio.action.improve', icon: Wand2 },
  { id: 'grammar', labelKey: 'ai.studio.action.grammar', icon: PencilLine },
];

const tones: { id: ActionType; labelKey: string; icon: typeof Megaphone }[] = [
  { id: 'professional', labelKey: 'ai.studio.tone.professional', icon: Megaphone },
  { id: 'friendly', labelKey: 'ai.studio.tone.friendly', icon: Megaphone },
  { id: 'marketing', labelKey: 'ai.studio.tone.marketing', icon: Megaphone },
  { id: 'sales', labelKey: 'ai.studio.tone.sales', icon: Megaphone },
  { id: 'storytelling', labelKey: 'ai.studio.tone.storytelling', icon: Megaphone },
];

const platforms = [
  { id: 'facebook', labelKey: 'ai.studio.platform.facebook', icon: Facebook },
  { id: 'instagram', labelKey: 'ai.studio.platform.instagram', icon: Instagram },
  { id: 'linkedin', labelKey: 'ai.studio.platform.linkedin', icon: Linkedin },
];

type AudienceType = 'general' | 'recruitment' | 'customers';

const audiences: { id: AudienceType; labelKey: string }[] = [
  { id: 'general', labelKey: 'ai.studio.audience.general' },
  { id: 'recruitment', labelKey: 'ai.studio.audience.recruitment' },
  { id: 'customers', labelKey: 'ai.studio.audience.customers' },
];

// Overrides the broad brand-voice audience with a specific focus for this
// generation only (doesn't touch the saved Brand Voice settings).
const audiencePrompts: Record<AudienceType, string> = {
  general: '',
  recruitment: 'Target audience for this post: job recruitment. Address university/college graduates aged 22-35 who are considering a sales career. Do not mention insurance policies or products for customers.',
  customers: 'Target audience for this post: insurance customers. Address business owners, employees, and freelancers aged 30-50 who are considering buying an insurance policy. Do not mention job openings or recruitment.',
};

const generators: { id: GeneratorType; labelKey: string; icon: typeof Lightbulb }[] = [
  { id: 'hooks', labelKey: 'ai.studio.generator.hooks', icon: Zap },
  { id: 'cta', labelKey: 'ai.studio.generator.cta', icon: Target },
  { id: 'hashtags', labelKey: 'ai.studio.generator.hashtags', icon: Hash },
  { id: 'carousel_outline', labelKey: 'ai.studio.generator.carouselOutline', icon: ListOrdered },
  { id: 'carousel_slides', labelKey: 'ai.studio.generator.carouselSlides', icon: ImageIcon },
  { id: 'reel_script', labelKey: 'ai.studio.generator.reelScript', icon: PencilLine },
  { id: 'video_script', labelKey: 'ai.studio.generator.videoScript', icon: PencilLine },
  { id: 'story_ideas', labelKey: 'ai.studio.generator.storyIdeas', icon: Lightbulb },
  { id: 'poll_ideas', labelKey: 'ai.studio.generator.pollIdeas', icon: ListChecks },
  { id: 'monthly_calendar', labelKey: 'ai.studio.generator.monthlyCalendar', icon: ListOrdered },
  { id: 'weekly_calendar', labelKey: 'ai.studio.generator.weeklyCalendar', icon: ListOrdered },
  { id: 'content_ideas', labelKey: 'ai.studio.generator.contentIdeas', icon: Lightbulb },
  { id: 'content_series', labelKey: 'ai.studio.generator.contentSeries', icon: Lightbulb },
];

const platformPrompts: Record<string, string> = {
  facebook: 'Write this post optimized for Facebook: engaging, conversational, with a clear hook and CTA. Keep it under 500 characters.',
  instagram: 'Write this post optimized for Instagram: visually descriptive, with emojis, relevant hashtags at the end. Keep it concise.',
  linkedin: 'Write this post optimized for LinkedIn: professional, insightful, with a strong opening line and thought-provoking CTA. Use short paragraphs.',
};

const actionPrompts: Record<ActionType, string> = {
  generate: 'Generate a social media post based on this topic.',
  rewrite: 'Rewrite this content in a fresh way while keeping the same message.',
  expand: 'Expand this content with more detail and depth.',
  shorten: 'Shorten this content to be more concise while keeping the key points.',
  translate: 'Translate this content into the target language specified.',
  improve: 'Improve this content to make it more engaging and impactful.',
  grammar: 'Fix any grammar, spelling, or punctuation issues in this content.',
  professional: 'Rewrite this content in a professional tone.',
  friendly: 'Rewrite this content in a friendly, approachable tone.',
  marketing: 'Rewrite this content in a marketing tone that drives engagement.',
  sales: 'Rewrite this content in a persuasive sales tone.',
  storytelling: 'Rewrite this content using a storytelling approach.',
};

const generatorPrompts: Record<GeneratorType, string> = {
  hooks: 'Generate 10 attention-grabbing hooks for social media posts about this topic.',
  cta: 'Generate 10 compelling call-to-action phrases for this topic.',
  hashtags: 'Generate 20 relevant and trending hashtags for this topic.',
  carousel_outline: 'Create a carousel post outline (5-7 slides) for this topic.',
  carousel_slides: 'Write the content for each slide of a 5-slide carousel post about this topic.',
  reel_script: 'Write a 30-second Instagram Reel script about this topic, including visual cues and voiceover.',
  video_script: 'Write a 60-second video script about this topic, including visual directions.',
  story_ideas: 'Generate 10 story ideas for social media stories about this topic.',
  poll_ideas: 'Generate 10 poll ideas for social media about this topic.',
  monthly_calendar: 'Create a monthly content calendar (4 weeks) for this topic, with one post per day.',
  weekly_calendar: 'Create a weekly content calendar (7 days) for this topic, with one post per day.',
  content_ideas: 'Generate 20 content ideas about this topic.',
  content_series: 'Create a 5-part content series about this topic, with a title and summary for each part.',
};

export function ContentStudioPage() {
  const { t } = useLanguage();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { generate, loading, model, tokensIn, tokensOut, responseTimeMs } = useAI();
  const { settings } = useAISettings();
  const { push } = useToast();
  const [input, setInput] = useState('');
  const [platform, setPlatform] = useState<string>('facebook');
  const [audience, setAudience] = useState<AudienceType>('general');
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const runAction = async (action: ActionType) => {
    if (!input.trim() || !workspace || !user) {
      push({ title: t('ai.studio.toast.enterContentFirst'), variant: 'error' });
      return;
    }
    setOutput('');
    setStreaming(true);
    const prompt = `${actionPrompts[action]}\n\n${platformPrompts[platform] ?? ''}\n\n${audiencePrompts[audience]}\n\nContent: ${input}`;
    const res = await generate({
      workspaceId: workspace.id,
      userId: user.id,
      messages: [{ role: 'user', content: prompt }],
      model: settings?.default_model,
      temperature: settings?.temperature,
      maxTokens: settings?.max_tokens,
      type: `content_${action}`,
      onChunk: (chunk) => setOutput((prev) => prev + chunk),
    });
    setStreaming(false);
    if (res.error) {
      push({ title: t('common.generationFailed'), description: res.error, variant: 'error' });
    } else {
      setOutput(res.result);
    }
  };

  const runGenerator = async (gen: GeneratorType) => {
    if (!input.trim() || !workspace || !user) {
      push({ title: t('ai.studio.toast.enterTopicFirst'), variant: 'error' });
      return;
    }
    setOutput('');
    setStreaming(true);
    const prompt = `${generatorPrompts[gen]}\n\n${audiencePrompts[audience]}\n\nTopic: ${input}`;
    const res = await generate({
      workspaceId: workspace.id,
      userId: user.id,
      messages: [{ role: 'user', content: prompt }],
      model: settings?.default_model,
      temperature: settings?.temperature,
      maxTokens: settings?.max_tokens,
      type: `generator_${gen}`,
      onChunk: (chunk) => setOutput((prev) => prev + chunk),
    });
    setStreaming(false);
    if (res.error) {
      push({ title: t('common.generationFailed'), description: res.error, variant: 'error' });
    } else {
      setOutput(res.result);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    push({ title: t('ai.studio.toast.copied'), variant: 'success' });
  };

  const handleDownload = () => {
    const blob = new Blob([output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'content.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('ai.studio.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('ai.studio.subtitle')}</p>
      </div>

      {/* Platform selector */}
      <div className="flex flex-wrap gap-2">
        {platforms.map((p) => (
          <button
            key={p.id}
            onClick={() => setPlatform(p.id)}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition ${
              platform === p.id
                ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'
            }`}
          >
            <p.icon className="h-4 w-4" /> {t(p.labelKey)}
          </button>
        ))}
      </div>

      {/* Audience selector */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('ai.studio.audienceLabel')}</p>
        <div className="flex flex-wrap gap-2">
          {audiences.map((a) => (
            <button
              key={a.id}
              onClick={() => setAudience(a.id)}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                audience === a.id
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'
              }`}
            >
              {t(a.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Input */}
        <Card title={t('ai.studio.input.title')} description={t('ai.studio.input.description')}>
          <div className="space-y-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
              placeholder={t('ai.studio.input.placeholder')}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            {/* Actions */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('ai.studio.actionsLabel')}</p>
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button key={a.id} variant="outline" size="sm" onClick={() => runAction(a.id)} loading={loading && !streaming}>
                    <a.icon className="h-3.5 w-3.5" /> {t(a.labelKey)}
                  </Button>
                ))}
              </div>
            </div>
            {/* Tones */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('ai.studio.tonesLabel')}</p>
              <div className="flex flex-wrap gap-2">
                {tones.map((tn) => (
                  <Button key={tn.id} variant="secondary" size="sm" onClick={() => runAction(tn.id)} loading={loading && !streaming}>
                    {t(tn.labelKey)}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Output */}
        <Card
          title={t('ai.studio.output.title')}
          description={t('ai.studio.output.description')}
          action={
            output && (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={handleCopy}><Copy className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={handleDownload}><Download className="h-3.5 w-3.5" /></Button>
              </div>
            )
          }
        >
          <div className="min-h-[200px]">
            {output ? (
              <div>
                <MarkdownRenderer content={output} />
                {streaming && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-slate-400" />}
                {!streaming && model && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <Badge variant="info">{model}</Badge>
                    <span>{t('ai.playground.tokens', { count: tokensIn + tokensOut })}</span>
                    <span>{t('ai.playground.responseTimeMs', { ms: responseTimeMs })}</span>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon={<Sparkles className="h-10 w-10" />}
                title={t('ai.studio.output.empty.title')}
                description={t('ai.studio.output.empty.description')}
              />
            )}
          </div>
        </Card>
      </div>

      {/* Content Generators */}
      <Card title={t('ai.studio.generators.title')} description={t('ai.studio.generators.description')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {generators.map((g) => (
            <button
              key={g.id}
              onClick={() => runGenerator(g.id)}
              disabled={loading}
              className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-3 text-center transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <g.icon className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{t(g.labelKey)}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
