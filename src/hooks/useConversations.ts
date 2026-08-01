import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/providers/AuthProvider';
import { conversationRepository, messageRepository } from '@/repositories/conversationRepository';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { Conversation, Message, ChatRole } from '@/types/ai';

type State = {
  conversations: Conversation[];
  activeId: string | null;
  messages: Message[];
  loading: boolean;
  error: string | null;
};

export function useConversations() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const [state, setState] = useState<State>({
    conversations: [],
    activeId: null,
    messages: [],
    loading: true,
    error: null,
  });

  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      const conversations = await conversationRepository.list(user.id);
      setState((s) => ({ ...s, conversations, loading: false }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Failed to load conversations', loading: false }));
    }
  }, [user]);

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const messages = await messageRepository.list(conversationId);
      setState((s) => ({ ...s, messages, activeId: conversationId }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Failed to load messages' }));
    }
  }, []);

  const createConversation = useCallback(
    async (title?: string, model?: string): Promise<Conversation | null> => {
      if (!user || !workspace) return null;
      try {
        const conv = await conversationRepository.create({
          workspace_id: workspace.id,
          title: title ?? 'New Conversation',
          model,
        });
        setState((s) => ({ ...s, conversations: [conv, ...s.conversations], activeId: conv.id, messages: [] }));
        return conv;
      } catch (e) {
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Failed to create conversation' }));
        return null;
      }
    },
    [user, workspace],
  );

  const addMessage = useCallback(
    async (conversationId: string, role: ChatRole, content: string, meta?: { model?: string; tokens?: number; response_time_ms?: number }): Promise<Message | null> => {
      try {
        const msg = await messageRepository.create({
          conversation_id: conversationId,
          role,
          content,
          model: meta?.model,
          tokens: meta?.tokens,
          response_time_ms: meta?.response_time_ms,
        });
        setState((s) => ({ ...s, messages: [...s.messages, msg] }));
        return msg;
      } catch (e) {
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Failed to add message' }));
        return null;
      }
    },
    [],
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    try {
      await conversationRepository.update(id, { title });
      setState((s) => ({
        ...s,
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Failed to rename' }));
    }
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      await conversationRepository.remove(id);
      setState((s) => ({
        ...s,
        conversations: s.conversations.filter((c) => c.id !== id),
        activeId: s.activeId === id ? null : s.activeId,
        messages: s.activeId === id ? [] : s.messages,
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Failed to delete' }));
    }
  }, []);

  const toggleFavorite = useCallback(async (id: string, favorite: boolean) => {
    try {
      await conversationRepository.toggleFavorite(id, favorite);
      setState((s) => ({
        ...s,
        conversations: s.conversations.map((c) => (c.id === id ? { ...c, favorite } : c)),
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Failed to toggle favorite' }));
    }
  }, []);

  const toggleMessageFavorite = useCallback(async (id: string, favorite: boolean) => {
    try {
      await messageRepository.toggleFavorite(id, favorite);
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === id ? { ...m, favorite } : m)),
      }));
    } catch (e) {
      setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Failed to toggle favorite' }));
    }
  }, []);

  const searchConversations = useCallback(
    async (query: string) => {
      if (!user || !query.trim()) {
        loadConversations();
        return;
      }
      try {
        const results = await conversationRepository.search(user.id, query);
        setState((s) => ({ ...s, conversations: results }));
      } catch (e) {
        setState((s) => ({ ...s, error: e instanceof Error ? e.message : 'Search failed' }));
      }
    },
    [user, loadConversations],
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  return {
    ...state,
    loadMessages,
    createConversation,
    addMessage,
    renameConversation,
    deleteConversation,
    toggleFavorite,
    toggleMessageFavorite,
    searchConversations,
  };
}
