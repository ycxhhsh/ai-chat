/**
 * AI 对话会话管理 Store — 类似 ChatGPT 的多轮对话管理。
 */
import { create } from 'zustand';
import { api } from '../api';

export interface AiConversation {
    conversation_id: string;
    title: string;
    llm_provider: string | null;
    message_count: number;
    created_at: string;
    updated_at: string;
}

interface AiConversationState {
    conversations: AiConversation[];
    currentConversationId: string | null;
    loading: boolean;

    fetchConversations: () => Promise<void>;
    createConversation: (llmProvider?: string) => Promise<AiConversation>;
    selectConversation: (id: string | null) => void;
    deleteConversation: (id: string) => Promise<void>;
    updateTitle: (id: string, title: string) => void;
    renameConversation: (id: string, title: string) => Promise<void>;
    clearAll: () => void;
}

export const useAiConversationStore = create<AiConversationState>((set, get) => ({
    conversations: [],
    currentConversationId: null,
    loading: false,

    fetchConversations: async () => {
        set({ loading: true });
        try {
            const data = await api.aiConversations.list();
            set({ conversations: data, loading: false });
        } catch (e) {
            console.error('Failed to fetch conversations:', e);
            set({ loading: false });
        }
    },

    createConversation: async (llmProvider?: string) => {
        const data = await api.aiConversations.create(llmProvider);
        set((s) => ({
            conversations: [data, ...s.conversations],
            currentConversationId: data.conversation_id,
        }));
        return data;
    },

    selectConversation: (id) => {
        const prev = get().currentConversationId;
        // 切换时，为旧对话异步生成摘要（fire-and-forget）
        if (prev && prev !== id) {
            api.aiConversations.summarize(prev).catch(() => { });
        }
        set({ currentConversationId: id });
    },

    deleteConversation: async (id) => {
        await api.aiConversations.delete(id);
        set((s) => {
            const filtered = s.conversations.filter(
                (c) => c.conversation_id !== id
            );
            return {
                conversations: filtered,
                currentConversationId:
                    s.currentConversationId === id
                        ? (filtered[0]?.conversation_id ?? null)
                        : s.currentConversationId,
            };
        });
    },

    updateTitle: (id, title) => {
        set((s) => ({
            conversations: s.conversations.map((c) =>
                c.conversation_id === id ? { ...c, title } : c
            ),
        }));
    },

    renameConversation: async (id, title) => {
        await api.aiConversations.rename(id, title);
        get().updateTitle(id, title);
    },

    clearAll: () => {
        set({ conversations: [], currentConversationId: null, loading: false });
    },
}));
