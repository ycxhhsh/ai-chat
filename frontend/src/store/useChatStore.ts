/**
 * 聊天 Store — 消息管理、AI 状态。
 */
import { create } from 'zustand';
import type { ChatMessage, LLMProvider } from '../types';

interface ChatState {
    // 消息
    groupMessages: ChatMessage[];
    aiMessages: ChatMessage[];

    // AI 状态
    isAiTyping: boolean;
    aiStreamContent: string;

    // LLM 选择
    selectedProvider: string;
    availableProviders: LLMProvider[];

    // 会话
    sessionId: string;

    // Actions
    addGroupMessage: (msg: ChatMessage) => void;
    addAiMessage: (msg: ChatMessage) => void;
    setGroupMessages: (msgs: ChatMessage[]) => void;
    setAiMessages: (msgs: ChatMessage[]) => void;
    updateMessageStatus: (requestId: string, status: 'sent' | 'failed', messageId?: string) => void;
    setAiTyping: (typing: boolean) => void;
    appendAiStream: (chunk: string) => void;
    resetAiStream: () => void;
    setSelectedProvider: (provider: string) => void;
    setAvailableProviders: (providers: LLMProvider[]) => void;
    setSessionId: (id: string) => void;
    clearMessages: () => void;
}

export const useChatStore = create<ChatState>()((set) => ({
    groupMessages: [],
    aiMessages: [],
    isAiTyping: false,
    aiStreamContent: '',
    selectedProvider: 'deepseek',
    availableProviders: [],
    sessionId: '',

    addGroupMessage: (msg) =>
        set((s) => ({
            groupMessages: s.groupMessages.some(
                (m) => m.message_id === msg.message_id ||
                    (msg.request_id && m.request_id === msg.request_id)
            )
                ? s.groupMessages
                : [...s.groupMessages, msg],
        })),

    addAiMessage: (msg) =>
        set((s) => ({
            aiMessages: s.aiMessages.some(
                (m) => m.message_id === msg.message_id ||
                    (msg.request_id && m.request_id === msg.request_id)
            )
                ? s.aiMessages
                : [...s.aiMessages, msg],
        })),

    setGroupMessages: (msgs) => set({ groupMessages: msgs }),
    setAiMessages: (msgs) => set({ aiMessages: msgs }),

    updateMessageStatus: (requestId, status, messageId) =>
        set((s) => {
            const updateList = (list: ChatMessage[]) =>
                list.map((m) =>
                    m.request_id === requestId
                        ? { ...m, status, ...(messageId ? { message_id: messageId } : {}) }
                        : m
                );
            return {
                groupMessages: updateList(s.groupMessages),
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

    clearMessages: () =>
        set({ groupMessages: [], aiMessages: [], aiStreamContent: '' }),
}));
