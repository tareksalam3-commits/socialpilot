import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  Hash,
  Image,
  LayoutDashboard,
  Link2,
  MessageSquare,
  PenSquare,
  Search,
  Settings,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useAI } from '@/hooks/useAI';
import { useAISettings } from '@/hooks/useAISettings';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { persistGeneratedContent } from '@/services/contentPersistence';
import { Badge } from '@/ui';

type Command = {
  id: string;
  labelKey: string;
  description?: string;
  icon: typeof Sparkles;
  category: 'navigate' | 'generate' | 'action';
  action: () => void;
  keywords?: string[];
};

export function CommandBar() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');
  const [savedContentId, setSavedContentId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const navigate = useNavigate();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { generate } = useAI();
  const { settings } = useAISettings();
  const { push } = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const navCommands: Command[] = [
    { id: 'nav-dashboard', labelKey: 'ai.commandBar.nav.dashboard', icon: LayoutDashboard, category: 'navigate', action: () => navigate('/app/dashboard') },
    { id: 'nav-playground', labelKey: 'ai.commandBar.nav.playground', icon: MessageSquare, category: 'navigate', action: () => navigate('/app/playground') },
    { id: 'nav-studio', labelKey: 'ai.commandBar.nav.studio', icon: Wand2, category: 'navigate', action: () => navigate('/app/studio') },
    { id: 'nav-prompts', labelKey: 'ai.commandBar.nav.prompts', icon: Search, category: 'navigate', action: () => navigate('/app/prompts') },
    { id: 'nav-history', labelKey: 'ai.commandBar.nav.history', icon: CalendarClock, category: 'navigate', action: () => navigate('/app/ai-history') },
    { id: 'nav-analytics', labelKey: 'ai.commandBar.nav.analytics', icon: BarChart3, category: 'navigate', action: () => navigate('/app/analytics') },
    { id: 'nav-accounts', labelKey: 'ai.commandBar.nav.accounts', icon: Link2, category: 'navigate', action: () => navigate('/app/accounts') },
    { id: 'nav-scheduled', labelKey: 'ai.commandBar.nav.scheduled', icon: CalendarDays, category: 'navigate', action: () => navigate('/app/posts') },
    { id: 'nav-settings', labelKey: 'ai.commandBar.nav.settings', icon: Settings, category: 'navigate', action: () => navigate('/app/settings') },
    { id: 'nav-brand', labelKey: 'ai.commandBar.nav.brand', icon: Sparkles, category: 'navigate', action: () => navigate('/app/brand-voice') },
  ];

  const genCommands: Command[] = [
    { id: 'gen-linkedin', labelKey: 'ai.commandBar.gen.linkedin', icon: PenSquare, category: 'generate', keywords: ['linkedin', 'posts', 'generate'], action: () => runGenerate('Generate 10 engaging LinkedIn posts about your business. Each post should have a hook, body, and CTA.') },
    { id: 'gen-facebook', labelKey: 'ai.commandBar.gen.facebook', icon: PenSquare, category: 'generate', keywords: ['facebook', 'post', 'create'], action: () => runGenerate('Create an engaging Facebook post with a clear hook, body, and call-to-action.') },
    { id: 'gen-instagram', labelKey: 'ai.commandBar.gen.instagram', icon: Image, category: 'generate', keywords: ['instagram', 'post', 'create'], action: () => runGenerate('Create an engaging Instagram post with emojis and relevant hashtags.') },
    { id: 'gen-hashtags', labelKey: 'ai.commandBar.gen.hashtags', icon: Hash, category: 'generate', keywords: ['hashtags', 'generate'], action: () => runGenerate('Generate 20 relevant and trending hashtags for social media content.') },
    { id: 'gen-monthly', labelKey: 'ai.commandBar.gen.monthly', icon: CalendarDays, category: 'generate', keywords: ['monthly', 'calendar', 'plan', 'content'], action: () => runGenerate('Create a monthly content plan with 4 weeks of daily post ideas.') },
    { id: 'gen-rewrite', labelKey: 'ai.commandBar.gen.rewrite', icon: Wand2, category: 'generate', keywords: ['rewrite', 'last', 'post'], action: () => runGenerate('Rewrite this content in a fresh, engaging way: ') },
    { id: 'gen-schedule', labelKey: 'ai.commandBar.gen.schedule', icon: CalendarClock, category: 'action', keywords: ['schedule', 'tomorrow', '9am'], action: () => { push({ title: t('ai.commandBar.toast.schedulingTitle'), description: t('ai.commandBar.toast.schedulingDesc'), variant: 'info' }); navigate('/app/posts'); } },
  ];

  const allCommands = [...navCommands, ...genCommands];
  const filtered = query
    ? allCommands.filter((c) => {
        const q = query.toLowerCase();
        return t(c.labelKey).toLowerCase().includes(q) || c.keywords?.some((k) => k.includes(q));
      })
    : allCommands;

  const runGenerate = async (prompt: string) => {
    if (!workspace || !user) return;
    setGenerating(true);
    setResult('');
    setSavedContentId(null);
    const res = await generate({
      workspaceId: workspace.id,
      userId: user.id,
      messages: [{ role: 'user', content: prompt }],
      model: settings?.default_model,
      temperature: settings?.temperature,
      maxTokens: settings?.max_tokens,
      type: 'command_bar',
      onChunk: (chunk) => setResult((prev) => prev + chunk),
    });
    setGenerating(false);
    if (res.error) {
      push({ title: t('ai.commandBar.toast.generationFailed'), description: res.error, variant: 'error' });
      return;
    }
    if (res.result?.trim()) {
      try {
        const saved = await persistGeneratedContent({
          workspaceId: workspace.id,
          content: res.result,
          platforms: [],
          source: 'command_bar',
          sourceLabel: 'Quick Generate',
          stage: 'generated',
          metadata: {
            command_bar: {
              prompt,
              model: res.model ?? settings?.default_model ?? null,
              tokens: res.tokensIn + res.tokensOut,
              response_time_ms: res.responseTimeMs,
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
  };

  const handleSelect = (cmd: Command) => {
    if (cmd.category === 'generate' || cmd.category === 'action') {
      cmd.action();
      if (cmd.category === 'generate') {
        // keep the bar open to show result
      } else {
        setOpen(false);
        setQuery('');
      }
    } else {
      cmd.action();
      setOpen(false);
      setQuery('');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-20">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('ai.commandBar.placeholder')}
            className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-white"
          />
          <Badge variant="info">CTRL+K</Badge>
          <button onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600">{t('ai.commandBar.esc')}</button>
        </div>

        {result ? (
          <div className="max-h-96 overflow-y-auto p-4">
            <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Sparkles className="h-3.5 w-3.5" /> {t('ai.commandBar.aiResult')}
            </div>
            <div className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
              {result}
              {generating && <span className="ms-1 inline-block h-3 w-1.5 animate-pulse bg-slate-400" />}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => { navigate(`/app/playground${savedContentId ? `?content=${savedContentId}` : ''}`); setOpen(false); }} className="text-xs text-sky-600 hover:underline dark:text-sky-400">{t('workflow.openWorkspace')}</button>
              <button onClick={() => { navigator.clipboard.writeText(result); push({ title: t('ai.commandBar.copied'), variant: 'success' }); }} className="text-xs text-slate-500 hover:underline">{t('ai.commandBar.copy')}</button>
            </div>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto p-2">
            {filtered.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('ai.commandBar.noResults')}</p>
              </div>
            ) : (
              filtered.map((cmd) => (
                <button
                  key={cmd.id}
                  onClick={() => handleSelect(cmd)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-start transition hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                    <cmd.icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{t(cmd.labelKey)}</p>
                    {cmd.description && <p className="text-xs text-slate-500 dark:text-slate-400">{cmd.description}</p>}
                  </div>
                  <Badge variant={cmd.category === 'navigate' ? 'default' : cmd.category === 'generate' ? 'info' : 'warning'}>
                    {t(`ai.commandBar.category.${cmd.category}`)}
                  </Badge>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
