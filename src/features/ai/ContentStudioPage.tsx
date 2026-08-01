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

const actions: { id: ActionType; label: string; icon: typeof Wand2 }[] = [
  { id: 'generate', label: 'Generate', icon: Sparkles },
  { id: 'rewrite', label: 'Rewrite', icon: Repeat2 },
  { id: 'expand', label: 'Expand', icon: Plus },
  { id: 'shorten', label: 'Shorten', icon: Scissors },
  { id: 'translate', label: 'Translate', icon: Type },
  { id: 'improve', label: 'Improve', icon: Wand2 },
  { id: 'grammar', label: 'Fix Grammar', icon: PencilLine },
];

const tones: { id: ActionType; label: string; icon: typeof Megaphone }[] = [
  { id: 'professional', label: 'Professional', icon: Megaphone },
  { id: 'friendly', label: 'Friendly', icon: Megaphone },
  { id: 'marketing', label: 'Marketing', icon: Megaphone },
  { id: 'sales', label: 'Sales', icon: Megaphone },
  { id: 'storytelling', label: 'Storytelling', icon: Megaphone },
];

const platforms = [
  { id: 'facebook', label: 'Facebook', icon: Facebook },
  { id: 'instagram', label: 'Instagram', icon: Instagram },
  { id: 'linkedin', label: 'LinkedIn', icon: Linkedin },
];

const generators: { id: GeneratorType; label: string; icon: typeof Lightbulb }[] = [
  { id: 'hooks', label: 'Hooks', icon: Zap },
  { id: 'cta', label: 'CTA', icon: Target },
  { id: 'hashtags', label: 'Hashtags', icon: Hash },
  { id: 'carousel_outline', label: 'Carousel Outline', icon: ListOrdered },
  { id: 'carousel_slides', label: 'Carousel Slides', icon: ImageIcon },
  { id: 'reel_script', label: 'Reel Script', icon: PencilLine },
  { id: 'video_script', label: 'Video Script', icon: PencilLine },
  { id: 'story_ideas', label: 'Story Ideas', icon: Lightbulb },
  { id: 'poll_ideas', label: 'Poll Ideas', icon: ListChecks },
  { id: 'monthly_calendar', label: 'Monthly Calendar', icon: ListOrdered },
  { id: 'weekly_calendar', label: 'Weekly Calendar', icon: ListOrdered },
  { id: 'content_ideas', label: 'Content Ideas', icon: Lightbulb },
  { id: 'content_series', label: 'Content Series', icon: Lightbulb },
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
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { generate, loading, model, tokensIn, tokensOut, responseTimeMs } = useAI();
  const { settings } = useAISettings();
  const { push } = useToast();
  const [input, setInput] = useState('');
  const [platform, setPlatform] = useState<string>('facebook');
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const runAction = async (action: ActionType) => {
    if (!input.trim() || !workspace || !user) {
      push({ title: 'Enter some content first', variant: 'error' });
      return;
    }
    setOutput('');
    setStreaming(true);
    const prompt = `${actionPrompts[action]}\n\n${platformPrompts[platform] ?? ''}\n\nContent: ${input}`;
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
      push({ title: 'Generation failed', description: res.error, variant: 'error' });
    } else {
      setOutput(res.result);
    }
  };

  const runGenerator = async (gen: GeneratorType) => {
    if (!input.trim() || !workspace || !user) {
      push({ title: 'Enter a topic first', variant: 'error' });
      return;
    }
    setOutput('');
    setStreaming(true);
    const prompt = `${generatorPrompts[gen]}\n\nTopic: ${input}`;
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
      push({ title: 'Generation failed', description: res.error, variant: 'error' });
    } else {
      setOutput(res.result);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
    push({ title: 'Copied', variant: 'success' });
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
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Content Studio</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Generate, transform, and optimize content for any platform.</p>
      </div>

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
            <p.icon className="h-4 w-4" /> {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Input */}
        <Card title="Input" description="Write or paste your content here.">
          <div className="space-y-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
              placeholder="Enter your topic or content to generate, rewrite, expand, or transform…"
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            {/* Actions */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Actions</p>
              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button key={a.id} variant="outline" size="sm" onClick={() => runAction(a.id)} loading={loading && !streaming}>
                    <a.icon className="h-3.5 w-3.5" /> {a.label}
                  </Button>
                ))}
              </div>
            </div>
            {/* Tones */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Tones</p>
              <div className="flex flex-wrap gap-2">
                {tones.map((t) => (
                  <Button key={t.id} variant="secondary" size="sm" onClick={() => runAction(t.id)} loading={loading && !streaming}>
                    {t.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Output */}
        <Card
          title="Output"
          description="AI-generated content"
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
                    <span>{tokensIn + tokensOut} tokens</span>
                    <span>{responseTimeMs}ms</span>
                  </div>
                )}
              </div>
            ) : (
              <EmptyState
                icon={<Sparkles className="h-10 w-10" />}
                title="No output yet"
                description="Choose an action above to generate content."
              />
            )}
          </div>
        </Card>
      </div>

      {/* Content Generators */}
      <Card title="Content Generators" description="Generate specific types of content from your topic.">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {generators.map((g) => (
            <button
              key={g.id}
              onClick={() => runGenerator(g.id)}
              disabled={loading}
              className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 p-3 text-center transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            >
              <g.icon className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">{g.label}</span>
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
