/**
 * 聊天 Store — 消息管理、AI 状态。
 *
 * P0 修复：groupMessages 从平坦数组重构为 Record<sessionId, ChatMessage[]>，
 * 按 session（小组）分片存储，实现跨组消息隔离。
 */
import { create } from 'zustand';
import type { ChatMessage, LLMProvider } from '../types';

interface ChatState {
    // 消息 — 按 session 分片
    groupMessagesBySession: Record<string, ChatMessage[]>;
    aiMessages: ChatMessage[];

    // AI 状态
    isAiTyping: boolean;
    aiStreamContent: string;

    // LLM 选择
    selectedProvider: string;
    availableProviders: LLMProvider[];

    // 会话
    sessionId: string;

    // 跨维度溯源
    highlightedMsgId: string | null;

    // P2: 支架建议
    scaffoldSuggestion: {
        scaffolds: { scaffold_id: string; label: string; content: string }[];
        recommendedIndex: number;
        learningState: string;
    } | null;

    // P3: 搜索来源
    searchSources: { title: string; url: string; content: string }[];

    // Actions
    addGroupMessage: (sessionId: string, msg: ChatMessage) => void;
    addAiMessage: (msg: ChatMessage) => void;
    setGroupMessages: (sessionId: string, msgs: ChatMessage[]) => void;
    getGroupMessages: (sessionId: string) => ChatMessage[];
    setAiMessages: (msgs: ChatMessage[]) => void;
    updateMessageStatus: (requestId: string, status: 'sent' | 'failed', messageId?: string) => void;
    setAiTyping: (typing: boolean) => void;
    appendAiStream: (chunk: string) => void;
    resetAiStream: () => void;
    setSelectedProvider: (provider: string) => void;
    setAvailableProviders: (providers: LLMProvider[]) => void;
    setSessionId: (id: string) => void;
    setHighlightedMsgId: (id: string | null) => void;
    setScaffoldSuggestion: (suggestion: ChatState['scaffoldSuggestion']) => void;
    clearScaffoldSuggestion: () => void;
    setSearchSources: (sources: ChatState['searchSources']) => void;
    clearSearchSources: () => void;
    clearMessages: () => void;
}

export const useChatStore = create<ChatState>()((set, get) => ({
    groupMessagesBySession: {},
    aiMessages: [],
    isAiTyping: false,
    aiStreamContent: '',
    selectedProvider: 'deepseek',
    availableProviders: [],
    sessionId: '',
    highlightedMsgId: null,
    scaffoldSuggestion: null,
    searchSources: [],

    addGroupMessage: (sessionId, msg) =>
        set((s) => {
            const existing = s.groupMessagesBySession[sessionId] || [];
            const isDuplicate = existing.some(
                (m) => m.message_id === msg.message_id ||
                    (msg.request_id && m.request_id === msg.request_id)
            );
            if (isDuplicate) return s;
            return {
                groupMessagesBySession: {
                    ...s.groupMessagesBySession,
                    [sessionId]: [...existing, msg],
                },
            };
        }),

    addAiMessage: (msg) =>
        set((s) => ({
            aiMessages: s.aiMessages.some(
                (m) => m.message_id === msg.message_id ||
                    (msg.request_id && m.request_id === msg.request_id)
            )
                ? s.aiMessages
                : [...s.aiMessages, msg],
        })),

    setGroupMessages: (sessionId, msgs) =>
        set((s) => ({
            groupMessagesBySession: {
                ...s.groupMessagesBySession,
                [sessionId]: msgs,
            },
        })),

    getGroupMessages: (sessionId) => {
        return get().groupMessagesBySession[sessionId] || [];
    },

    setAiMessages: (msgs) => set({ aiMessages: msgs }),

    updateMessageStatus: (requestId, status, messageId) =>
        set((s) => {
            const updateList = (list: ChatMessage[]) =>
                list.map((m) =>
                    m.request_id === requestId
                        ? { ...m, status, ...(messageId ? { message_id: messageId } : {}) }
                        : m
                );
            // 更新所有 session 分片中的消息状态
            const updatedSessions: Record<string, ChatMessage[]> = {};
            for (const [sid, msgs] of Object.entries(s.groupMessagesBySession)) {
                updatedSessions[sid] = updateList(msgs);
            }
            return {
                groupMessagesBySession: updatedSessions,
                aiMessages: updateList(s.aiMessages),
            };
        }),

    setAiTyping: (typing) => set({ isAiTyping: typing }),

    appendAiStream: (chunk) =>
        set((s) => ({ aiStreamContent: s.aiStreamContent + chunk })),

    resetAiStream: () => set({ aiStreamContent: '', isAiTyping: false }),

    setSelectedProvider: (provider) => set({ selectedProvider: provider }),
    setAvailableProviders: (providers) =>
        set({ availableProviders: providers }),

    setSessionId: (id) => set({ sessionId: id }),

    setHighlightedMsgId: (id) => set({ highlightedMsgId: id }),

    setScaffoldSuggestion: (suggestion) => set({ scaffoldSuggestion: suggestion }),
    clearScaffoldSuggestion: () => set({ scaffoldSuggestion: null }),

    setSearchSources: (sources) => set({ searchSources: sources }),
    clearSearchSources: () => set({ searchSources: [] }),

    clearMessages: () =>
        set({ groupMessagesBySession: {}, aiMessages: [], aiStreamContent: '', highlightedMsgId: null }),
}));
