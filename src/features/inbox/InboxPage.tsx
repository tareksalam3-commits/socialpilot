import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, CircleDot, Inbox, Search, Send, Settings, Sparkles, User as UserIcon } from 'lucide-react';
import { useInbox, useInboxAutomation } from '@/hooks/useInbox';
import { useAI } from '@/hooks/useAI';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { Badge, Button, EmptyState, Input, Modal, Select } from '@/ui';
import { timeAgo } from '@/utils/format';
import type { InboxAutomationRule, InboxConversation } from '@/types/social';

const platformColors: Record<string, string> = {
  facebook: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  instagram: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  linkedin: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
};

type InteractionStatus = 'all' | 'unread' | 'needs_reply' | 'replied' | 'needs_review';
type InteractionPriority = 'all' | 'high' | 'medium' | 'normal';

function interactionStatus(conversation: InboxConversation): Exclude<InteractionStatus, 'all'> {
  const metadata = conversation.metadata as { reply_status?: string };
  if (conversation.needs_review) return 'needs_review';
  if (metadata.reply_status === 'replied') return 'replied';
  if (conversation.unread) return 'unread';
  return 'needs_reply';
}

function interactionPriority(conversation: InboxConversation): Exclude<InteractionPriority, 'all'> {
  if (conversation.needs_review) return 'high';
  if (conversation.unread) return 'medium';
  return 'normal';
}

export function InboxPage() {
  const { conversations, activeId, messages, loading, showArchived, setShowArchived, searchQuery, setSearchQuery, loadMessages, sendMessage, archive, markRead, clearReview } = useInbox();
  const { generate } = useAI();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const { push } = useToast();
  const { t } = useLanguage();
  const [reply, setReply] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [platformFilter, setPlatformFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | InboxConversation['type']>('all');
  const [statusFilter, setStatusFilter] = useState<InteractionStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<InteractionPriority>('all');
  const msgEndRef = useRef<HTMLDivElement>(null);
  const activeConv = conversations.find((c) => c.id === activeId);
  const availablePlatforms = useMemo(() => Array.from(new Set(conversations.map((conversation) => conversation.platform))).sort(), [conversations]);
  const visibleConversations = useMemo(
    () =>
      conversations
        .filter((conversation) => platformFilter === 'all' || conversation.platform === platformFilter)
        .filter((conversation) => typeFilter === 'all' || conversation.type === typeFilter)
        .filter((conversation) => statusFilter === 'all' || interactionStatus(conversation) === statusFilter)
        .filter((conversation) => priorityFilter === 'all' || interactionPriority(conversation) === priorityFilter)
        .sort((a, b) => {
          const priorityOrder = { high: 0, medium: 1, normal: 2 };
          const priorityDelta = priorityOrder[interactionPriority(a)] - priorityOrder[interactionPriority(b)];
          return priorityDelta || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        }),
    [conversations, platformFilter, typeFilter, statusFilter, priorityFilter],
  );

  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Prefill an AI-generated draft (from draft_only automation) into the
  // reply box the moment its conversation is opened — same end result as
  // clicking the Sparkles button manually, just queued up by the rule.
  useEffect(() => {
    if (activeConv?.metadata?.ai_draft && !reply) setReply(activeConv.metadata.ai_draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

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
  }, [activeId, conversations, generate, workspace, user, push, t]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('inbox.title')}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t('inbox.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4" /> {t('inbox.autoReply.title')}
        </Button>
      </div>

      <AutoReplySettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <div className="flex h-[calc(100vh-14rem)] gap-4">
        {/* Conversation list */}
        <div className="flex w-72 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-200 p-3 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="search" placeholder={t('common.search')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white py-1.5 ps-9 pe-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
            </div>
          </div>
          <div className="space-y-2 border-b border-slate-200 p-2 dark:border-slate-800">
            <div className="flex gap-2">
              <button onClick={() => setShowArchived(false)} className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium ${!showArchived ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500'}`}>{t('inbox.active')}</button>
              <button onClick={() => setShowArchived(true)} className={`flex-1 rounded-lg px-2 py-1 text-xs font-medium ${showArchived ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-500'}`}>{t('inbox.archived')}</button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <select value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <option value="all">{t('inbox.filter.allPlatforms')}</option>
                {availablePlatforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
              </select>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as 'all' | InboxConversation['type'])} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <option value="all">{t('inbox.filter.allTypes')}</option>
                <option value="comment">{t('inbox.type.comment')}</option>
                <option value="dm">{t('inbox.type.dm')}</option>
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InteractionStatus)} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <option value="all">{t('inbox.filter.allStatuses')}</option>
                <option value="unread">{t('inbox.status.unread')}</option>
                <option value="needs_reply">{t('inbox.status.needs_reply')}</option>
                <option value="needs_review">{t('inbox.status.needs_review')}</option>
                <option value="replied">{t('inbox.status.replied')}</option>
              </select>
              <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as InteractionPriority)} className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <option value="all">{t('inbox.filter.allPriorities')}</option>
                <option value="high">{t('inbox.priority.high')}</option>
                <option value="medium">{t('inbox.priority.medium')}</option>
                <option value="normal">{t('inbox.priority.normal')}</option>
              </select>
            </div>
          </div>
          <div className="flex-1 space-y-1 overflow-y-auto p-2">
            {!loading && <p className="px-2 py-1 text-[11px] text-slate-400 dark:text-slate-500">{t('inbox.resultCount', { count: visibleConversations.length })}</p>}
            {loading ? <p className="p-4 text-center text-sm text-slate-500">{t('common.loading')}</p> : visibleConversations.length === 0 ? <p className="p-4 text-center text-sm text-slate-500">{t('inbox.noConversations')}</p> : visibleConversations.map((c) => (
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
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{activeConv?.sender_name ?? t('inbox.unknown')}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{activeConv?.platform}</p>
                  </div>
                  {activeConv?.needs_review && (
                    <Badge variant="warning" dot>
                      <AlertTriangle className="h-3 w-3" /> {t('inbox.autoReply.needsReview')}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {activeConv?.needs_review && (
                    <Button variant="ghost" size="sm" onClick={() => clearReview(activeId)} title={t('inbox.autoReply.clearReview')}>
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => archive(activeId, true)}><Archive className="h-4 w-4" /></Button>
                </div>
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

function AutoReplySettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const { push } = useToast();
  const { rules, loading, save, remove } = useInboxAutomation();
  // One workspace-wide rule (account_id: null) is all the UI exposes for
  // now — per-account rules are still supported by the schema/engine for
  // later, but a single toggle is enough for the common case.
  const existing = rules.find((r) => r.account_id === null) ?? null;

  const [enabled, setEnabled] = useState(false);
  const [scope, setScope] = useState<('dm' | 'comment')[]>(['dm', 'comment']);
  const [mode, setMode] = useState<InboxAutomationRule['mode']>('draft_only');
  const [toneOverride, setToneOverride] = useState('');
  const [businessHoursOnly, setBusinessHoursOnly] = useState(false);
  const [excludedKeywords, setExcludedKeywords] = useState('');
  const [maxPerDay, setMaxPerDay] = useState(20);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEnabled(existing?.enabled ?? false);
    setScope(existing?.scope ?? ['dm', 'comment']);
    setMode(existing?.mode ?? 'draft_only');
    setToneOverride(existing?.tone_override ?? '');
    setBusinessHoursOnly(existing?.business_hours_only ?? false);
    setExcludedKeywords((existing?.excluded_keywords ?? []).join(', '));
    setMaxPerDay(existing?.max_auto_replies_per_day ?? 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const toggleScope = (value: 'dm' | 'comment') => {
    setScope((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  };

  const handleSave = async () => {
    setSaving(true);
    const result = await save({
      id: existing?.id,
      account_id: null,
      enabled,
      scope,
      mode,
      tone_override: toneOverride.trim() || null,
      business_hours_only: businessHoursOnly,
      excluded_keywords: excludedKeywords.split(',').map((k) => k.trim()).filter(Boolean),
      max_auto_replies_per_day: maxPerDay,
    });
    setSaving(false);
    if (result) {
      push({ title: t('inbox.autoReply.saved'), variant: 'success' });
      onClose();
    }
  };

  const handleDisable = async () => {
    if (!existing) return;
    setSaving(true);
    await remove(existing.id);
    setSaving(false);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t('inbox.autoReply.title')} description={t('inbox.autoReply.description')} size="md" footer={
      <>
        {existing && <Button variant="outline" onClick={handleDisable} loading={saving}>{t('inbox.autoReply.turnOff')}</Button>}
        <Button onClick={handleSave} loading={saving || loading}>{t('common.save')}</Button>
      </>
    }>
      <div className="space-y-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          {t('inbox.autoReply.enable')}
        </label>

        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">{t('inbox.autoReply.scope')}</p>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input type="checkbox" checked={scope.includes('dm')} onChange={() => toggleScope('dm')} className="h-4 w-4 rounded border-slate-300" />
              {t('inbox.autoReply.dm')}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
              <input type="checkbox" checked={scope.includes('comment')} onChange={() => toggleScope('comment')} className="h-4 w-4 rounded border-slate-300" />
              {t('inbox.autoReply.comments')}
            </label>
          </div>
        </div>

        <Select label={t('inbox.autoReply.mode')} value={mode} onChange={(e) => setMode(e.target.value as InboxAutomationRule['mode'])}>
          <option value="draft_only">{t('inbox.autoReply.modeDraft')}</option>
          <option value="auto_send">{t('inbox.autoReply.modeAutoSend')}</option>
        </Select>

        <Input label={t('inbox.autoReply.tone')} value={toneOverride} onChange={(e) => setToneOverride(e.target.value)} placeholder={t('inbox.autoReply.toneHint')} />

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input type="checkbox" checked={businessHoursOnly} onChange={(e) => setBusinessHoursOnly(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          {t('inbox.autoReply.businessHours')}
        </label>

        <Input
          label={t('inbox.autoReply.excludedKeywords')}
          hint={t('inbox.autoReply.excludedKeywordsHint')}
          value={excludedKeywords}
          onChange={(e) => setExcludedKeywords(e.target.value)}
          placeholder={t('inbox.autoReply.excludedKeywordsPlaceholder')}
        />

        <Input
          type="number"
          min={1}
          max={200}
          label={t('inbox.autoReply.maxPerDay')}
          value={maxPerDay}
          onChange={(e) => setMaxPerDay(Number(e.target.value) || 1)}
        />
      </div>
    </Modal>
  );
}

function ConversationItem({ conv, active, onClick, onArchive }: { conv: InboxConversation; active: boolean; onClick: () => void; onArchive: () => void }) {
  const { t } = useLanguage();
  return (
    <div className={`group flex items-start gap-2 rounded-lg px-3 py-2 transition ${active ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'}`}>
      <button onClick={onClick} className="flex-1 text-start">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${platformColors[conv.platform] ?? 'bg-slate-100 text-slate-600'}`}>{conv.platform}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t(`inbox.type.${conv.type}`)}</span>
          {interactionStatus(conv) === 'replied' ? <CheckCircle2 className="h-3 w-3 text-emerald-500" /> : interactionStatus(conv) === 'needs_review' ? <AlertTriangle className="h-3 w-3 text-amber-500" /> : <CircleDot className="h-3 w-3 text-sky-500" />}
          {interactionPriority(conv) === 'high' && <AlertTriangle className="h-3 w-3 text-rose-500" />}
        </div>
        <p className="mt-1 truncate text-sm font-medium text-slate-900 dark:text-white">{conv.sender_name ?? t('inbox.unknown')}</p>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{conv.snippet ?? t('inbox.noPreview')}</p>
        <p className="mt-0.5 text-xs text-slate-400">{timeAgo(conv.updated_at)}</p>
      </button>
      <button onClick={onArchive} className="text-slate-400 opacity-0 transition hover:text-slate-600 group-hover:opacity-100 dark:hover:text-slate-200"><Archive className="h-3.5 w-3.5" /></button>
    </div>
  );
}
