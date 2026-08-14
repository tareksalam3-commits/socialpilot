import { useState } from 'react';
import { MessageSquare, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/providers/LanguageProvider';
import { PlaygroundChat } from '@/features/ai/PlaygroundPage';
import { PostsPage } from '@/features/posts/PostsPage';
import { Button, Tabs } from '@/ui';

type WorkspaceView = 'content' | 'chat';

const workflowSteps = [
  'contentWorkspace.step.generate',
  'contentWorkspace.step.saved',
  'contentWorkspace.step.edit',
  'contentWorkspace.step.review',
  'contentWorkspace.step.improve',
  'contentWorkspace.step.schedule',
  'contentWorkspace.step.publish',
] as const;

/**
 * The workflow home for every persisted generated item. It intentionally
 * composes the existing Posts surface instead of duplicating any content,
 * scheduling, publishing or database logic.
 */
export function ContentWorkspacePage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [view, setView] = useState<WorkspaceView>('content');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('contentWorkspace.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">{t('contentWorkspace.subtitle')}</p>
        </div>
        <Button onClick={() => navigate('/app/studio')}>
          <Sparkles className="h-4 w-4" /> {t('contentWorkspace.generate')}
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('contentWorkspace.workflowLabel')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {workflowSteps.map((step, index) => (
            <div key={step} className="flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {index + 1}. {t(step)}
              </span>
              {index < workflowSteps.length - 1 && <span className="hidden text-slate-300 sm:inline dark:text-slate-600">→</span>}
            </div>
          ))}
        </div>
      </div>

      <Tabs
        tabs={[
          { id: 'content', label: t('contentWorkspace.tab.content') },
          { id: 'chat', label: t('contentWorkspace.tab.chat') },
        ]}
        active={view}
        onChange={(id) => setView(id as WorkspaceView)}
      />

      {view === 'content' ? <PostsPage embedded /> : <PlaygroundChat />}

      {view === 'chat' && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          {t('contentWorkspace.chatHint')}
        </div>
      )}
    </div>
  );
}
