import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Edit2,
  MessageSquarePlus,
  Plus,
  Send,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { useConversations } from '@/hooks/useConversations';
import { useAI } from '@/hooks/useAI';
import { useAISettings } from '@/hooks/useAISettings';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useLanguage } from '@/providers/LanguageProvider';
import { MarkdownRenderer, Button, Input, Badge, EmptyState } from '@/ui';
import type { Conversation } from '@/types/ai';

export function PlaygroundPage() {
  const { t } = useLanguage();
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const {
    conversations,
    activeId,
    messages,
    loading,
    loadMessages,
    createConversation,
    addMessage,
    renameConversation,
    deleteConversation,
    toggleFavorite,
    toggleMessageFavorite,
    searchConversations,
  } = useConversations();
  const { generate, loading: aiLoading } = useAI();
  const { settings } = useAISettings();
  const { push } = useToast();

  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  useEffect(() => {
    if (search) {
      const t = setTimeout(() => searchConversations(search), 300);
      return () => clearTimeout(t);
    }
  }, [search, searchConversations]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !workspace || !user) return;

    let convId = activeId;
    if (!convId) {
      const conv = await createConversation(input.slice(0, 40) || t('ai.playground.newConversationTitle'), settings?.default_model);
      convId = conv?.id ?? null;
      if (!convId) return;
    }

    const userMessage = input;
    setInput('');
    setStreamingContent('');

    await addMessage(convId, 'user', userMessage);

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const result = await generate({
      workspaceId: workspace.id,
      userId: user.id,
      messages: [...history, { role: 'user', content: userMessage }],
      model: settings?.default_model,
      temperature: settings?.temperature,
      maxTokens: settings?.max_tokens,
      type: 'playground',
      onChunk: (chunk) => {
        setStreamingContent((prev) => prev + chunk);
      },
    });

    setStreamingContent('');
    if (result.result) {
      await addMessage(convId, 'assistant', result.result, {
        model: result.model ?? undefined,
        tokens: result.tokensIn + result.tokensOut,
        response_time_ms: result.responseTimeMs,
      });
    }
    if (result.error) {
      push({ title: t('ai.playground.generationFailed'), description: result.error, variant: 'error' });
    }
  }, [input, workspace, user, activeId, messages, settings, createConversation, addMessage, generate, push]);

  const handleNewChat = () => {
    createConversation(t('ai.playground.newConversationTitle'), settings?.default_model);
    setInput('');
    setStreamingContent('');
  };

  const handleRename = async (id: string) => {
    if (editTitle.trim()) {
      await renameConversation(id, editTitle.trim());
    }
    setEditingId(null);
  };

  const handleCopy = (content: string) => {
    navigator.clipboard.writeText(content);
    push({ title: t('ai.playground.copiedToClipboard'), variant: 'success' });
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Sidebar: conversations */}
      <div className="flex w-64 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 p-3 dark:border-slate-800">
          <Button size="sm" className="w-full" onClick={handleNewChat}>
            <Plus className="h-4 w-4" /> {t('ai.playground.newChat')}
          </Button>
        </div>
        <div className="border-b border-slate-200 p-3 dark:border-slate-800">
          <Input
            type="search"
            placeholder={t('ai.playground.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {loading ? (
            <p className="p-4 text-center text-sm text-slate-500">{t('ai.playground.loading')}</p>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-500">{t('ai.playground.noConversations')}</p>
          ) : (
            conversations.map((conv) => (
              <ConversationItem
                key={conv.id}
                conv={conv}
                active={conv.id === activeId}
                editing={editingId === conv.id}
                editTitle={editTitle}
                onEditTitle={setEditTitle}
                onEdit={(id, title) => {
                  setEditingId(id);
                  setEditTitle(title);
                }}
                onSaveEdit={() => handleRename(conv.id)}
                onCancelEdit={() => setEditingId(null)}
                onClick={() => loadMessages(conv.id)}
                onToggleFav={() => toggleFavorite(conv.id, !conv.favorite)}
                onDelete={() => deleteConversation(conv.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Main: chat area */}
      <div className="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              {conversations.find((c) => c.id === activeId)?.title ?? t('ai.playground.defaultTitle')}
            </span>
            {settings?.default_model && (
              <Badge variant="info">{settings.default_model}</Badge>
            )}
          </div>
          {settings?.streaming && <Badge variant="success">{t('ai.playground.streaming')}</Badge>}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 && !streamingContent ? (
            <EmptyState
              icon={<MessageSquarePlus className="h-10 w-10" />}
              title={t('ai.playground.empty.title')}
              description={t('ai.playground.empty.description')}
            />
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  model={msg.model}
                  tokens={msg.tokens}
                  responseTime={msg.response_time_ms}
                  favorite={msg.favorite}
                  onCopy={() => handleCopy(msg.content)}
                  onToggleFav={() => toggleMessageFavorite(msg.id, !msg.favorite)}
                />
              ))}
              {streamingContent && (
                <MessageBubble role="assistant" content={streamingContent} streaming />
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={t('ai.playground.inputPlaceholder')}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <Button onClick={handleSend} loading={aiLoading} disabled={!input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConversationItem({
  conv,
  active,
  editing,
  editTitle,
  onEditTitle,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onClick,
  onToggleFav,
  onDelete,
}: {
  conv: Conversation;
  active: boolean;
  editing: boolean;
  editTitle: string;
  onEditTitle: (v: string) => void;
  onEdit: (id: string, title: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onClick: () => void;
  onToggleFav: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={`group flex items-center gap-2 rounded-lg px-3 py-2 transition ${
        active ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
      }`}
    >
      {editing ? (
        <div className="flex flex-1 items-center gap-1">
          <input
            value={editTitle}
            onChange={(e) => onEditTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSaveEdit()}
            className="flex-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-900"
            autoFocus
          />
          <button onClick={onSaveEdit}><Check className="h-3.5 w-3.5 text-emerald-500" /></button>
          <button onClick={onCancelEdit}><X className="h-3.5 w-3.5 text-slate-400" /></button>
        </div>
      ) : (
        <>
          <button onClick={onClick} className="flex-1 truncate text-left text-sm text-slate-700 dark:text-slate-300">
            {conv.title}
          </button>
          <div className="hidden gap-1 group-hover:flex">
            <button onClick={onToggleFav} className="text-slate-400 hover:text-amber-500" title={t('ai.playground.favorite')}>
              <Star className={`h-3.5 w-3.5 ${conv.favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
            </button>
            <button onClick={() => onEdit(conv.id, conv.title)} className="text-slate-400 hover:text-slate-600" title={t('ai.playground.rename')}>
              <Edit2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={onDelete} className="text-slate-400 hover:text-rose-500" title={t('ai.playground.delete')}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {conv.favorite && <Star className="h-3 w-3 fill-amber-400 text-amber-400 group-hover:hidden" />}
        </>
      )}
    </div>
  );
}

function MessageBubble({
  role,
  content,
  model,
  tokens,
  responseTime,
  favorite,
  streaming,
  onCopy,
  onToggleFav,
}: {
  role: string;
  content: string;
  model?: string | null;
  tokens?: number;
  responseTime?: number | null;
  favorite?: boolean;
  streaming?: boolean;
  onCopy?: () => void;
  onToggleFav?: () => void;
}) {
  const { t } = useLanguage();
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-3 ${
          isUser
            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
            : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm">{content}</p>
        ) : (
          <MarkdownRenderer content={content} />
        )}
        {streaming && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-slate-400" />}
        {!streaming && !isUser && (
          <div className="mt-2 flex items-center gap-3 border-t border-slate-200/50 pt-2 text-xs text-slate-500 dark:border-slate-700/50 dark:text-slate-400">
            {model && <span className="font-mono">{model}</span>}
            {tokens ? <span>{t('ai.playground.tokens', { count: tokens })}</span> : null}
            {responseTime ? <span>{t('ai.playground.responseTimeMs', { ms: responseTime })}</span> : null}
            <div className="flex gap-2">
              {onCopy && (
                <button onClick={onCopy} className="transition hover:text-slate-700 dark:hover:text-slate-200" title={t('ai.playground.copy')}>
                  <Copy className="h-3 w-3" />
                </button>
              )}
              {onToggleFav && (
                <button onClick={onToggleFav} className="transition hover:text-amber-500" title={t('ai.playground.favorite')}>
                  <Star className={`h-3 w-3 ${favorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
