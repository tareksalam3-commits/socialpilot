import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/hooks/useWorkspace';
import { inboxRepository, notificationRepository } from '@/repositories/inboxRepository';
import type { InboxConversation, InboxMessage, Notification } from '@/types/social';

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

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const data = await inboxRepository.listMessages(conversationId);
      setMessages(data);
      setActiveId(conversationId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    }
  }, []);

  const sendMessage = useCallback(async (conversationId: string, content: string, isAi = false) => {
    try {
      const msg = await inboxRepository.sendMessage({ conversation_id: conversationId, content, is_ai: isAi });
      setMessages((prev) => [...prev, msg]);
      await inboxRepository.update(conversationId, { snippet: content, unread: false });
      return msg;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send message');
      return null;
    }
  }, []);

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
    reload: loadConversations,
  };
}

export function useNotifications() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const data = await notificationRepository.list(user.id);
      setNotifications(data);
      setUnreadCount(data.filter((n) => !n.read).length);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const sub = notificationRepository.subscribe(user.id, (payload) => {
      if (payload.eventType === 'INSERT') {
        setNotifications((prev) => [payload.new, ...prev]);
        setUnreadCount((prev) => prev + 1);
      }
    });
    return () => {
      supabaseRemoveSubscription(sub);
    };
  }, [user]);

  const markRead = useCallback(async (id: string) => {
    await notificationRepository.markRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnreadCount((prev) => Math.max(0, prev - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    await notificationRepository.markAllRead(user.id);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
  }, [user]);

  const create = useCallback(
    async (type: Notification['type'], title: string, message?: string) => {
      if (!workspace || !user) return;
      await notificationRepository.create({ workspace_id: workspace.id, user_id: user.id, type, title, message });
    },
    [workspace, user],
  );

  return { notifications, loading, unreadCount, markRead, markAllRead, create, reload: load };
}

function supabaseRemoveSubscription(sub: { unsubscribe: () => void }) {
  sub.unsubscribe();
}
