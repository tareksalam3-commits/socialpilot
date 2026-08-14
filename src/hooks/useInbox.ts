import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { supabase } from '@/services/supabase';
import { inboxAutomationRepository, inboxRepository, notificationRepository } from '@/repositories/inboxRepository';
import type { InboxAutomationRule, InboxConversation, InboxMessage, Notification } from '@/types/social';

export function useInbox() {
  const { workspace } = useWorkspace();
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const loadConversations = useCallback(
    async (signal?: { active: boolean }) => {
      if (!workspace) return;
      try {
        setLoading(true);
        const data = searchQuery
          ? await inboxRepository.search(workspace.id, searchQuery)
          : await inboxRepository.listConversations(workspace.id, { archived: showArchived });
        if (!signal || signal.active) setConversations(data);
      } catch (e) {
        if (!signal || signal.active) setError(e instanceof Error ? e.message : 'Failed to load inbox');
      } finally {
        if (!signal || signal.active) setLoading(false);
      }
    },
    [workspace, showArchived, searchQuery],
  );

  useEffect(() => {
    const signal = { active: true };
    // Debounce so typing in the search box doesn't fire a request per keystroke,
    // and guard against out-of-order responses overwriting fresher results.
    const handle = setTimeout(() => loadConversations(signal), searchQuery ? 300 : 0);
    return () => {
      signal.active = false;
      clearTimeout(handle);
    };
  }, [loadConversations, searchQuery]);

  // Live updates via Supabase Realtime — inbox_conversations now feeds from
  // inbox-webhook (real inbound messages), not just manual edits, so
  // without this the list would only refresh on next page load.
  useEffect(() => {
    if (!workspace) return;
    const channel = supabase
      .channel(`inbox-conversations-${workspace.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inbox_conversations', filter: `workspace_id=eq.${workspace.id}` }, () => loadConversations())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspace, loadConversations]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const data = await inboxRepository.listMessages(conversationId);
      setMessages(data);
      setActiveId(conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    }
  }, []);

  // Live updates for the open thread — an inbound reply from the customer
  // (or an automated AI reply firing from inbox-webhook) should appear
  // without the user having to reselect the conversation.
  useEffect(() => {
    if (!activeId) return;
    const channel = supabase
      .channel(`inbox-messages-${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inbox_messages', filter: `conversation_id=eq.${activeId}` }, (payload) => {
        const newMessage = (payload as unknown as { new: InboxMessage }).new;
        setMessages((prev) => (prev.some((m) => m.id === newMessage.id) ? prev : [...prev, newMessage]));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  const sendMessage = useCallback(async (conversationId: string, content: string, isAi = false) => {
    try {
      const msg = await inboxRepository.sendMessage({ conversation_id: conversationId, content, is_ai: isAi });
      const current = conversations.find((conversation) => conversation.id === conversationId);
      const metadata = {
        ...(current?.metadata ?? {}),
        reply_status: 'replied',
        last_replied_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);
      await inboxRepository.update(conversationId, { snippet: content, unread: false, needs_review: false, metadata });
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, snippet: content, unread: false, needs_review: false, metadata, updated_at: new Date().toISOString() }
            : conversation,
        ),
      );
      return msg;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
      return null;
    }
  }, [conversations]);

  const archive = useCallback(async (id: string, archived: boolean) => {
    try {
      await inboxRepository.update(id, { archived });
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive');
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    try {
      await inboxRepository.update(id, { unread: false });
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
    } catch {
      // best-effort
    }
  }, []);

  const assign = useCallback(async (id: string, userId: string | null) => {
    try {
      await inboxRepository.update(id, { assigned_to: userId });
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, assigned_to: userId } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to assign');
    }
  }, []);

  // Clears the "needs review" flag an automation rule set (excluded keyword
  // hit, or daily auto-reply limit reached) once a human has looked at it.
  const clearReview = useCallback(async (id: string) => {
    try {
      await inboxRepository.update(id, { needs_review: false });
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, needs_review: false } : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update');
    }
  }, []);

  return {
    conversations,
    activeId,
    messages,
    loading,
    error,
    showArchived,
    setShowArchived,
    searchQuery,
    setSearchQuery,
    loadMessages,
    sendMessage,
    archive,
    markRead,
    assign,
    clearReview,
    reload: loadConversations,
  };
}

/** Auto-Reply rules — a small CRUD hook backing the settings modal in
 * InboxPage, kept separate from useInbox so the conversation list logic
 * above stays focused. */
export function useInboxAutomation() {
  const { workspace } = useWorkspace();
  const { user } = useAuth();
  const [rules, setRules] = useState<InboxAutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setLoading(true);
      setError(null);
      setRules(await inboxAutomationRepository.list(workspace.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load automation rules');
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    async (rule: Partial<InboxAutomationRule> & { id?: string }) => {
      if (!workspace || !user) return null;
      try {
        const saved = await inboxAutomationRepository.upsert({ ...rule, workspace_id: workspace.id, created_by: rule.created_by ?? user.id });
        setRules((prev) => {
          const exists = prev.some((r) => r.id === saved.id);
          return exists ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev];
        });
        return saved;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save rule');
        return null;
      }
    },
    [workspace, user],
  );

  const remove = useCallback(async (id: string) => {
    try {
      await inboxAutomationRepository.remove(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete rule');
    }
  }, []);

  return { rules, loading, error, save, remove, reload: load };
}

const NOTIFICATIONS_PAGE_SIZE = 50;

export function useNotifications() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const data = await notificationRepository.list(user.id, NOTIFICATIONS_PAGE_SIZE, 0);
      setNotifications(data);
      setHasMore(data.length === NOTIFICATIONS_PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates via Supabase Realtime (postgres_changes on the `notifications` table).
  useEffect(() => {
    if (!user) return;
    const channel = notificationRepository.subscribe(user.id, (payload) => {
      if (payload.eventType === 'INSERT') {
        setNotifications((prev) => (prev.some((n) => n.id === payload.new.id) ? prev : [payload.new, ...prev]));
      } else if (payload.eventType === 'UPDATE') {
        setNotifications((prev) => prev.map((n) => (n.id === payload.new.id ? payload.new : n)));
      } else if (payload.eventType === 'DELETE') {
        setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
      }
    });
    // Fully deregister the channel on unmount so React 18 StrictMode's
    // mount/unmount/remount in dev doesn't leave duplicate subscriptions
    // (channel.unsubscribe() alone closes the socket topic but keeps the
    // channel tracked on the client, which can cause missed/duplicate events).
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const loadMore = useCallback(async () => {
    if (!user || loadingMore || !hasMore) return;
    try {
      setLoadingMore(true);
      const data = await notificationRepository.list(user.id, NOTIFICATIONS_PAGE_SIZE, notifications.length);
      setNotifications((prev) => {
        const existingIds = new Set(prev.map((n) => n.id));
        return [...prev, ...data.filter((n) => !existingIds.has(n.id))];
      });
      setHasMore(data.length === NOTIFICATIONS_PAGE_SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load more notifications');
    } finally {
      setLoadingMore(false);
    }
  }, [user, notifications.length, loadingMore, hasMore]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await notificationRepository.markRead(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark notification as read');
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
    }
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    const previous = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await notificationRepository.markAllRead(user.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all notifications as read');
      setNotifications(previous);
    }
  }, [user, notifications]);

  const deleteNotification = useCallback(async (id: string) => {
    const previous = notifications;
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    try {
      await notificationRepository.remove(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete notification');
      setNotifications(previous);
    }
  }, [notifications]);

  const create = useCallback(
    async (type: Notification['type'], title: string, message?: string) => {
      if (!workspace || !user) return;
      await notificationRepository.create({ workspace_id: workspace.id, user_id: user.id, type, title, message });
    },
    [workspace, user],
  );

  return {
    notifications,
    loading,
    loadingMore,
    hasMore,
    error,
    unreadCount,
    markRead,
    markAllRead,
    deleteNotification,
    loadMore,
    create,
    reload: load,
  };
}
