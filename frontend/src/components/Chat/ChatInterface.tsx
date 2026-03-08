/**
 * 聊天界面主组件 — Sprint 3 UI 升级。
 * 支架移到底部输入区上方；现代浮动输入框；气泡最大宽度80%。
 * Sprint 2: 支持跨维度溯源滚动高亮。
 * Sprint 7: 流式渲染防抖优化。
 */
import React, { useCallback, useEffect, useDeferredValue, useRef } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useChatStore } from '../../store/useChatStore';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ScaffoldBar } from './ScaffoldBar';
import { LLMSelector } from './LLMSelector';
import type { ChatMessage } from '../../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
    messages: ChatMessage[];
    onSend: (content: string, metadata?: Record<string, unknown>) => void;
    title?: string;
    showScaffolds?: boolean;
    isAiChannel?: boolean;
}

export const ChatInterface: React.FC<Props> = ({
    messages,
    onSend,
    title = '对话',
    showScaffolds = true,
    isAiChannel = false,
}) => {
    const { user } = useAuthStore();
    const { isAiTyping, aiStreamContent, highlightedMsgId } = useChatStore();
    const scrollRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);

    // 流式内容防抖：useDeferredValue 在高频更新时自动跳过中间帧
    const deferredStream = useDeferredValue(aiStreamContent);

    // 节流滚动：用 rAF 合并高频滚动请求
    const scrollToBottom = useCallback(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        });
    }, []);

    // 消息变化 / 流式内容变化时滚动
    useEffect(() => {
        scrollToBottom();
    }, [messages, deferredStream, scrollToBottom]);

    // cleanup rAF
    useEffect(() => {
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, []);

    // 跨维度溯源：滚动到高亮消息
    useEffect(() => {
        if (!highlightedMsgId) return;
        const el = document.getElementById(`msg-${highlightedMsgId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [highlightedMsgId]);

    return (
        <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Header — 简洁标题 + LLM 选择器 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
                <LLMSelector />
            </div>

            {/* Messages 区域 */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto px-4 py-4 space-y-1"
            >
                {messages.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-300">
                        <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-3">
                            <span className="text-2xl">💬</span>
                        </div>
                        <p className="text-sm font-medium">
                            {isAiChannel ? '开始与 AI 导师对话' : '输入 @AI 发起对话'}
                        </p>
                        <p className="text-xs mt-1 text-gray-300">
                            {isAiChannel ? '试试提出一个问题' : '在消息前加 @AI 触发 AI 回复'}
                        </p>
                    </div>
                )}

                {messages.map((msg) => (
                    <MessageBubble
                        key={msg.message_id}
                        message={msg}
                        isOwn={msg.sender.id === user?.user_id}
                    />
                ))}

                {/* AI 打字中 — 使用 deferredStream 防抖渲染 */}
                {isAiTyping && (
                    <div className="flex gap-2.5 mb-3 max-w-[80%]">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 text-white flex items-center justify-center text-xs font-medium flex-shrink-0">
                            AI
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-violet-400 mb-1">AI 助教</p>
                            <div className="px-3.5 py-2.5 bg-violet-50 border border-violet-100 rounded-2xl rounded-bl-md text-sm text-gray-800 leading-relaxed">
                                {deferredStream ? (
                                    <div className="prose prose-sm prose-blue max-w-none leading-relaxed [&>p]:mb-1.5 [&>p:last-child]:mb-0 [&>ul]:mb-1.5 [&>ol]:mb-1.5 [&_li]:mb-0.5 [&_code]:bg-violet-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {deferredStream}
                                        </ReactMarkdown>
                                    </div>
                                ) : (
                                    <span className="inline-flex gap-1">
                                        <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                        <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                        <span className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ── 底部区域：支架 + 输入框 ── */}
            <div className="relative rounded-t-2xl bg-white shadow-[0_-4px_20px_-10px_rgba(0,0,0,0.08)] border-t border-gray-100">
                {/* 支架标签（移到这里，在输入框上方水平滚动） */}
                {showScaffolds && <ScaffoldBar />}

                {/* 输入框 */}
                <ChatInput onSend={onSend} isAiChannel={isAiChannel} />
            </div>
        </div>
    );
};

