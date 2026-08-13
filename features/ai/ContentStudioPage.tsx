import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Copy,
  Download,
  Facebook,
  FileSpreadsheet,
  FileText,
  Globe,
  Hash,
  ImageIcon,
  Instagram,
  Layers,
  Lightbulb,
  Linkedin,
  ListChecks,
  ListOrdered,
  PencilLine,
  RefreshCw,
  Rss,
  Sparkles,
  Target,
  TrendingUp,
  Youtube,
  Zap,
} from 'lucide-react';
import { useAI } from '@/hooks/useAI';
import { useAISettings } from '@/hooks/useAISettings';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useContentSources } from '@/hooks/useContentSources';
import { useContentInsights } from '@/hooks/useContentInsights';
import { useBrandVoice } from '@/hooks/useBrandVoice';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { persistGeneratedContent } from '@/services/contentPersistence';
import { resolveWorkspaceDialect } from '@/constants/dialects';
import { buildArabicWritingRules } from '@/engines/contentEngine/arabicWritingRules';
import { runCreatorAgent, reviewGeneratedContent } from '@/engines/aiOrchestrator';
import { Button, Card, MarkdownRenderer, Badge, EmptyState } from '@/ui';
import type { ContentSourceType } from '@/types/contentSources';
import type { CampaignPlan } from '@/types/assistant';

function sourceIcon(type: ContentSourceType) {
  switch (type) {
    case 'rss': return Rss;
    case 'url': return Globe;
    case 'youtube': return Youtube;
    case 'excel': return FileSpreadsheet;
    default: return FileText;
  }
}

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
  | 'content_series'
  | 'ready_posts';

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
  { id: 'ready_posts', labelKey: 'ai.studio.generator.readyPosts', icon: Layers },
];

const platformPrompts: Record<string, string> = {
  facebook: 'Write this post optimized for Facebook: engaging, conversational, with a clear hook and CTA. Keep it under 500 characters.',
  instagram: 'Write this post optimized for Instagram: visually descriptive, with emojis, relevant hashtags at the end. Keep it concise.',
  linkedin: 'Write this post optimized for LinkedIn: professional, insightful, with a strong opening line and thought-provoking CTA. Use short paragraphs.',
};

// No topic is typed by the user anymore — every generator works purely off
// automatic context (brand voice + content sources + insights, assembled in
// buildContextBlock below), so each prompt describes the deliverable only.
const generatorPrompts: Record<GeneratorType, string> = {
  hooks: 'Generate 10 attention-grabbing hooks for social media posts, based on the brand context and material below.',
  cta: 'Generate 10 compelling call-to-action phrases, based on the brand context and material below.',
  hashtags: 'Generate 20 relevant and trending hashtags, based on the brand context and material below.',
  carousel_outline: 'Create a carousel post outline (5-7 slides), based on the brand context and material below.',
  carousel_slides: 'Write the content for each slide of a 5-slide carousel post, based on the brand context and material below.',
  reel_script: 'Write a 30-second Instagram Reel script, including visual cues and voiceover, based on the brand context and material below.',
  video_script: 'Write a 60-second video script, including visual directions, based on the brand context and material below.',
  story_ideas: 'Generate 10 story ideas for social media stories, based on the brand context and material below.',
  poll_ideas: 'Generate 10 poll ideas for social media, based on the brand context and material below.',
  monthly_calendar: 'Create a monthly content calendar (4 weeks), with one post idea per day, based on the brand context and material below.',
  weekly_calendar: 'Create a weekly content calendar (7 days), with one post idea per day, based on the brand context and material below.',
  content_ideas: 'Generate 20 content ideas, based on the brand context and material below.',
  content_series: 'Create a 5-part content series with a title and summary for each part, based on the brand context and material below.',
  ready_posts: 'Create five distinct, ready-to-publish social media posts, based on the brand context and material below.',
};

export function ContentStudioPage() {
  const { t } = useLanguage();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { generate, model, tokensIn, tokensOut, responseTimeMs } = useAI();
  const { settings } = useAISettings();
  const { push } = useToast();
  const navigate = useNavigate();

  const [platform, setPlatform] = useState<string>('facebook');
  const [audience, setAudience] = useState<AudienceType>('general');
  const [output, setOutput] = useState('');
  const [savedContentId, setSavedContentId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [activeGenerator, setActiveGenerator] = useState<GeneratorType | null>(null);

  // The three automatic inputs every generator draws from — no manual entry
  // anywhere in this page.
  const { brandVoice } = useBrandVoice();
  const { sources, fetching, proposedItems, fetchNewContent } = useContentSources();
  const { learnings, recommendations, loading: insightsLoading, refresh: refreshInsights } = useContentInsights();

  const refreshingContext = fetching || insightsLoading;
  const refreshContext = () => {
    fetchNewContent();
    refreshInsights();
  };

  const activeRecommendations = recommendations
    .filter((r) => r.status !== 'DISMISSED' && r.status !== 'EXPIRED')
    .slice(0, 5);
  const activeLearnings = learnings.filter((l) => l.status === 'ACTIVE').slice(0, 5);
  const latestSourceItems = proposedItems.slice(0, 5);

  // Assembled fresh on every click so a generator always uses the latest
  // brand voice / sources / insights state, without the user typing anything.
  const buildContextBlock = () => {
    const blocks: string[] = [];

    if (activeRecommendations.length > 0) {
      blocks.push(
        `Data-driven recommendations to apply (learned from past content performance):\n${activeRecommendations
          .map((r) => `- [${r.type}] ${r.recommendation}${r.reason ? ` (${r.reason})` : ''}`)
          .join('\n')}`,
      );
    }

    if (activeLearnings.length > 0) {
      blocks.push(
        `Learnings from what has performed well before:\n${activeLearnings.map((l) => `- ${l.learning}`).join('\n')}`,
      );
    }

    if (latestSourceItems.length > 0) {
      blocks.push(
        `Fresh raw material from the brand's content sources (use for inspiration/topics — summarize or rephrase, never copy verbatim):\n${latestSourceItems
          .map((i) => `- ${i.title}: ${i.summary}`)
          .join('\n')}`,
      );
    }

    if (blocks.length === 0) {
      blocks.push(
        'No specific source material or performance data is available yet — choose a relevant, on-brand topic based on the brand voice, industry, and audience.',
      );
    }

    return blocks.join('\n\n');
  };

  // This is the same language/dialect entry point used by the assistant and
  // the quality engine. Studio generators must never rely on the UI locale.
  const buildContentLanguageInstruction = () => {
    if (workspace?.language === 'ar') {
      const dialect = resolveWorkspaceDialect(workspace);
      return `${buildArabicWritingRules(dialect)}\n\nقاعدة إلزامية: اكتب المخرجات بالعربية فقط وباللهجة المحددة أعلاه. لا تكتب أي عناوين أو شروح أو بدائل باللغة الإنجليزية.`;
    }
    return `MANDATORY OUTPUT LANGUAGE: ${workspace?.language || 'en'}. Write the entire output only in this workspace content language; do not mix languages unless the brand material itself requires a proper noun.`;
  };

  const generateReadyPosts = async () => {
    if (!workspace || !user) return;

    const dialect = resolveWorkspaceDialect(workspace);
    const languageInstruction = buildContentLanguageInstruction();
    const plan: CampaignPlan = {
      objective: 'Create five distinct, ready-to-publish social media posts that are useful, specific, and aligned with the workspace context.',
      audience: audience === 'recruitment' ? 'job recruitment candidates' : audience === 'customers' ? 'current and potential customers' : brandVoice?.audience || 'the workspace audience',
      platforms: [platform],
      post_count: 5,
      cadence: 'once',
      start: 'now',
      time_of_day: '12:00',
      notes: `${audiencePrompts[audience]}\n\n${buildContextBlock()}`,
      use_content_sources: latestSourceItems.length > 0,
    };
    const originalRequest = `${languageInstruction}\n\nGenerate five different ready-to-publish posts. Each post must use a different angle, hook, and value proposition. Respect the selected platform and the workspace's brand, insights, and content sources.`;

    setOutput('');
    setSavedContentId(null);
    setStreaming(true);
    setActiveGenerator('ready_posts');

    const generatedPosts: string[] = [];
    let lastSavedId: string | null = null;
    let failures = 0;

    try {
      for (let index = 0; index < 5; index += 1) {
        const created = await runCreatorAgent(
          workspace.id,
          plan,
          index,
          { model: settings?.default_model, temperature: settings?.temperature, maxTokens: settings?.max_tokens },
          null,
          originalRequest,
          dialect,
        );
        if (created.error || !created.content.trim()) {
          failures += 1;
          continue;
        }

        const review = workspace.language === 'ar'
          ? await reviewGeneratedContent(
              workspace.id,
              created.content,
              [platform],
              originalRequest,
              // Quality Control Model Separation: prefer the dedicated
              // qc_model, and always exclude the exact model that just
              // authored `created.content` — QC never grades itself.
              { model: settings?.qc_model ?? undefined, maxTokens: settings?.max_tokens },
              dialect,
              created.model,
            )
          : { result: null, error: null };
        const quality = review.result;
        const needsReview = workspace.language === 'ar' && (!quality || !quality.approved);
        const stage = quality?.approved ? 'approved' : needsReview ? 'in_review' : 'generated';

        try {
          const saved = await persistGeneratedContent({
            workspaceId: workspace.id,
            title: created.content.split('\n').find((line) => line.trim())?.trim().slice(0, 80),
            content: created.content,
            platforms: [platform],
            source: 'content_studio_ready_posts',
            sourceLabel: 'Content Studio · 5 Ready Posts',
            stage,
            quality,
            needsReview,
            platformVariants: { [platform]: created.content },
            metadata: {
              content_studio: {
                generator: 'ready_posts',
                platform,
                audience,
                sequence: index + 1,
                total: 5,
                language: workspace.language,
                dialect,
              },
            },
          });
          lastSavedId = saved.id;
          generatedPosts.push(created.content);
        } catch {
          failures += 1;
        }
      }

      setOutput(generatedPosts.map((content, index) => `## ${t('ai.studio.readyPosts.postLabel', { count: index + 1 })}\n\n${content}`).join('\n\n---\n\n'));
      setSavedContentId(lastSavedId);
      if (generatedPosts.length > 0) {
        push({ title: t('ai.studio.readyPosts.saved', { count: generatedPosts.length }), variant: 'success' });
      }
      if (failures > 0) {
        push({ title: t('ai.studio.readyPosts.partialFailure', { count: failures }), variant: 'info' });
      }
    } catch (error) {
      push({
        title: t('common.generationFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'error',
      });
    } finally {
      setStreaming(false);
      setActiveGenerator(null);
    }
  };

  const runGenerator = async (gen: GeneratorType) => {
    if (gen === 'ready_posts') {
      await generateReadyPosts();
      return;
    }
    if (!workspace || !user) return;
    setOutput('');
    setSavedContentId(null);
    setStreaming(true);
    setActiveGenerator(gen);
    const languageInstruction = buildContentLanguageInstruction();
    const dialect = resolveWorkspaceDialect(workspace);
    const prompt = `${generatorPrompts[gen]}\n\n${platformPrompts[platform] ?? ''}\n\n${audiencePrompts[audience]}\n\n${buildContextBlock()}`;
    const res = await generate({
      workspaceId: workspace.id,
      userId: user.id,
      messages: [
        { role: 'system', content: languageInstruction },
        { role: 'user', content: prompt },
      ],
      model: settings?.default_model,
      temperature: settings?.temperature,
      maxTokens: settings?.max_tokens,
      type: `generator_${gen}`,
      onChunk: (chunk) => setOutput((prev) => prev + chunk),
    });
    setStreaming(false);
    setActiveGenerator(null);
    if (res.error) {
      push({ title: t('common.generationFailed'), description: res.error, variant: 'error' });
    } else {
      setOutput(res.result);
      if (res.result?.trim()) {
        try {
          const saved = await persistGeneratedContent({
            workspaceId: workspace.id,
            content: res.result,
            platforms: [platform],
            source: 'content_studio',
            sourceLabel: 'Content Studio',
            stage: 'generated',
            platformVariants: { [platform]: res.result },
            metadata: {
              content_studio: {
                generator: gen,
                platform,
                audience,
                prompt,
                language: workspace.language,
                dialect,
                model: res.model ?? settings?.default_model ?? null,
              },
            },
          });
          setSavedContentId(saved.id);
          push({ title: t('workflow.savedToWorkspace'), variant: 'success' });
        } catch (persistError) {
          push({
            title: t('workflow.saveFailed'),
            description: persistError instanceof Error ? persistError.message : undefined,
            variant: 'error',
          });
        }
      }
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

      {/* Generation context — everything a generator button draws from,
          entirely read-only. Nothing here is typed by the user. */}
      <Card
        title={t('ai.studio.context.title')}
        description={t('ai.studio.context.description')}
        action={
          <Button variant="outline" size="sm" onClick={refreshContext} loading={refreshingContext}>
            <RefreshCw className="h-3.5 w-3.5" /> {t('ai.studio.context.refresh')}
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Brand voice */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Sparkles className="h-3.5 w-3.5" /> {t('ai.studio.context.brandVoice')}
            </p>
            {brandVoice?.business_name || brandVoice?.tone ? (
              <div className="flex flex-wrap gap-1.5">
                {brandVoice.business_name && <Badge variant="default">{brandVoice.business_name}</Badge>}
                {brandVoice.tone && <Badge variant="default">{brandVoice.tone}</Badge>}
                {brandVoice.industry && <Badge variant="default">{brandVoice.industry}</Badge>}
              </div>
            ) : (
              <button onClick={() => navigate('/app/brand-voice')} className="text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                {t('ai.studio.context.brandVoiceEmpty')}
              </button>
            )}
          </div>

          {/* Content sources */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Layers className="h-3.5 w-3.5" /> {t('ai.studio.context.sources')}
            </p>
            {sources.length === 0 ? (
              <button onClick={() => navigate('/app/content-sources')} className="text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                {t('ai.studio.context.sourcesEmpty')}
              </button>
            ) : latestSourceItems.length > 0 ? (
              <ul className="space-y-1">
                {latestSourceItems.map((item) => {
                  const Icon = sourceIcon(item.source_type);
                  return (
                    <li key={item.content_hash} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                      <Icon className="mt-0.5 h-3 w-3 shrink-0 text-slate-400" />
                      <span className="truncate">{item.title}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('ai.studio.context.sourcesNoFresh')}</p>
            )}
          </div>

          {/* AI insights & recommendations */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <TrendingUp className="h-3.5 w-3.5" /> {t('ai.studio.context.insights')}
            </p>
            {activeRecommendations.length === 0 && activeLearnings.length === 0 ? (
              <button onClick={() => navigate('/app/insights')} className="text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                {t('ai.studio.context.insightsEmpty')}
              </button>
            ) : (
              <ul className="space-y-1">
                {activeRecommendations.slice(0, 3).map((r) => (
                  <li key={r.id} className="truncate text-xs text-slate-600 dark:text-slate-400">{r.recommendation}</li>
                ))}
                {activeLearnings.slice(0, 3).map((l) => (
                  <li key={l.id} className="truncate text-xs text-slate-600 dark:text-slate-400">{l.learning}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {/* Platform selector */}
      <div className="flex gap-2">
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
        <div className="flex gap-2">
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
        {/* Content Generators */}
        <Card title={t('ai.studio.generators.title')} description={t('ai.studio.generators.description')}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {generators.map((g) => (
              <button
                key={g.id}
                onClick={() => runGenerator(g.id)}
                disabled={streaming}
                className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-3 text-center transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              >
                {activeGenerator === g.id && streaming ? (
                  <RefreshCw className="h-5 w-5 animate-spin text-slate-500 dark:text-slate-400" />
                ) : (
                  <g.icon className="h-5 w-5 text-slate-500 dark:text-slate-400" />
                )}
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{t(g.labelKey)}</span>
              </button>
            ))}
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
                {savedContentId && (
                  <Button variant="outline" size="sm" onClick={() => navigate(`/app/playground?content=${savedContentId}`)}>
                    {t('workflow.openWorkspace')}
                  </Button>
                )}
              </div>
            )
          }
        >
          <div className="min-h-[200px]">
            {output ? (
              <div>
                <MarkdownRenderer content={output} />
                {streaming && <span className="ms-1 inline-block h-3 w-1.5 animate-pulse bg-slate-400" />}
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
    </div>
  );
}
