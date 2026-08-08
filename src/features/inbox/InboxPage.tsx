import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Inbox, Search, Send, Sparkles, User as UserIcon } from 'lucide-react';
import { useInbox } from '@/hooks/useInbox';
import { useAI } from '@/hooks/useAI';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Button, EmptyState } from '@/ui';
import { timeAgo } from '@/utils/format';
import type { InboxConversation } from '@/types/social';

const platformColors: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  instagram: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  linkedin: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
};

export function InboxPage() {
  const { conversations, activeId, messages, loading, showArchived, setShowArchived, searchQuery, setSearchQuery, loadMessages, sendMessage, archive, markRead } = useInbox();
  const { generate } = useAI();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { push } = useToast();
  const { t } = useLanguage();
  const [reply, setReply] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const msgEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!reply.trim() || !activeId) return;
    await sendMessage(activeId, reply.trim());
    setReply('');
  };

  const handleAIReply = useCallback(async () => {
    if (!activeId || !workspace || !user) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv) return;
    setAiGenerating(true);
    const res = await generate({
      workspaceId: workspace.id,
      userId: user.id,
      messages: [{ role: 'user', content: `Write a helpful, friendly reply to this ${conv.type} from ${conv.sender_name ?? 'a user'} on ${conv.platform}: "${conv.snippet ?? ''}"` }],
      type: 'inbox_reply',
    });
    setAiGenerating(false);
    if (res.result) {
      setReply(res.result);
      push({ title: t('inbox.toast.aiReplyGenerated'), variant: 'success' });
    }
  }, [activeId, conversations, generate, workspace, user, push]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('inbox.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('inbox.subtitle')}</p>
      </div>

      <div className="flex h-[calc(100vh-14rem)] gap-4">
        {/* Conversation list */}
        <div className="flex w-72 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" placeholder={t('common.search')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white py-1.5 ps-9 pe-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            </div>
          </div>
          <div className="flex gap-2 border-b border-slate-200 p-2 dark:border-slate-800">
            <button onClick={() => setShowArchived(false)} className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium ${!showArchived ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500'}`}>{t('inbox.active')}</button>
            <button onClick={() => setShowArchived(true)} className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium ${showArchived ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500'}`}>{t('inbox.archived')}</button>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {loading ? <p className="p-4 text-center text-sm text-slate-500">{t('common.loading')}</p> : conversations.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">{t('inbox.noConversations')}</p> : conversations.map((c) => (
              <ConversationItem key={c.id} conv={c} active={c.id === activeId} onClick={() => { loadMessages(c.id); markRead(c.id); }} onArchive={() => archive(c.id, !c.archived)} />
            ))}
          </div>
        </div>

        {/* Message thread */}
        <div className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {activeId ? (
            <>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700">
                    <UserIcon className="h-4 w-4 text-slate-500" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{conversations.find((c) => c.id === activeId)?.sender_name ?? t('inbox.unknown')}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{conversations.find((c) => c.id === activeId)?.platform}</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => archive(activeId, true)}><Archive className="h-4 w-4" /></Button>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.direction === 'outbound' ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'}`}>
                      {m.is_ai && <Sparkles className="mb-1 h-3 w-3 opacity-60" />}
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      <p className="mt-1 text-xs opacity-60">{timeAgo(m.created_at)}</p>
                    </div>
                  </div>
                ))}
                <div ref={msgEndRef} />
              </div>
              <div className="border-t border-slate-200 p-3 dark:border-slate-800">
                <div className="flex items-end gap-2">
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }} rows={2} placeholder={t('inbox.replyPlaceholder')} className="flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                  <div className="flex flex-col gap-1">
                    <Button size="sm" variant="outline" onClick={handleAIReply} loading={aiGenerating} title={t('inbox.generateAiReply')}><Sparkles className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" onClick={handleSend} disabled={!reply.trim()}><Send className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center"><EmptyState icon={<Inbox className="h-10 w-10" />} title={t('inbox.selectConversation')} description={t('inbox.selectConversationDesc')} /></div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConversationItem({ conv, active, onClick, onArchive }: { conv: InboxConversation; active: boolean; onClick: () => void; onArchive: () => void }) {
  const { t } = useLanguage();
  return (
    <div className={`group flex items-start gap-2 rounded-lg px-3 py-2 transition ${active ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
      <button onClick={onClick} className="flex-1 text-start">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${platformColors[conv.platform] ?? 'bg-slate-100 text-slate-600'}`}>{conv.platform}</span>
          {conv.unread && <span className="h-2 w-2 rounded-full bg-sky-500" />}
        </div>
        <p className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-white">{conv.sender_name ?? t('inbox.unknown')}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{conv.snippet ?? t('inbox.noPreview')}</p>
        <p className="mt-0.5 text-xs text-slate-400">{timeAgo(conv.updated_at)}</p>
      </button>
      <button onClick={onArchive} className="text-slate-400 opacity-0 transition hover:text-slate-600 group-hover:opacity-100 dark:hover:text-slate-200"><Archive className="h-3.5 w-3.5" /></button>
    </div>
  );
}
