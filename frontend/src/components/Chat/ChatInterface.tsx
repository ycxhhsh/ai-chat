/**
 * 聊天界面主组件 — Sprint 3 UI 升级。
 * 支架移到底部输入区上方；现代浮动输入框；气泡最大宽度80%。
 * Sprint 2: 支持跨维度溯源滚动高亮。
 * Sprint 7: 流式渲染防抖优化。
 * P0: 长对话虚拟化（>50 条启用 react-window）+ 搜索来源自动清理。
 */
import React, { useCallback, useEffect, useDeferredValue, useRef, useState } from 'react';
import { List, type ListImperativeAPI } from 'react-window';
import { useAuthStore } from '../../store/useAuthStore';
import { useChatStore } from '../../store/useChatStore';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { ScaffoldBar } from './ScaffoldBar';
import { ScaffoldSuggest } from './ScaffoldSuggest';
import { LLMSelector } from './LLMSelector';
import type { ChatMessage } from '../../types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** 虚拟化阈值：超过此条数启用 react-window */
const VIRTUALIZE_THRESHOLD = 50;

/** 根据消息内容估算行高 */
const estimateRowHeight = (msg: ChatMessage): number => {
    const len = msg.content?.length || 0;
    if (len < 50) return 72;
    if (len < 150) return 96;
    if (len < 400) return 140;
    return 180;
};

interface Props {
    messages: ChatMessage[];
    onSend: (content: string, metadata?: Record<string, unknown>) => void;
    title?: string;
    showScaffolds?: boolean;
    isAiChannel?: boolean;
    disabled?: boolean;
}

export const ChatInterface: React.FC<Props> = ({
    messages,
    onSend,
    title = '对话',
    showScaffolds = true,
    isAiChannel = false,
    disabled = false,
}) => {
    const { user } = useAuthStore();
    const { isAiTyping, aiStreamContent, highlightedMsgId, scaffoldSuggestion, clearScaffoldSuggestion, searchSources, clearSearchSources } = useChatStore();
    const scrollRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<ListImperativeAPI>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const rafRef = useRef<number>(0);
    const [isDeepThinking, setIsDeepThinking] = useState(false);
    const [isSearchEnabled, setIsSearchEnabled] = useState(false);
    const [containerHeight, setContainerHeight] = useState(400);

    const useVirtualization = messages.length > VIRTUALIZE_THRESHOLD;

    // 流式内容防抖：useDeferredValue 在高频更新时自动跳过中间帧
    const deferredStream = useDeferredValue(aiStreamContent);

    // 监听容器高度变化（虚拟化需要精确高度）
    useEffect(() => {
        if (!useVirtualization || !containerRef.current) return;
        const obs = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerHeight(entry.contentRect.height);
            }
        });
        obs.observe(containerRef.current);
        return () => obs.disconnect();
    }, [useVirtualization]);

    // 节流滚动：用 rAF 合并高频滚动请求
    const scrollToBottom = useCallback(() => {
        if (useVirtualization) {
            listRef.current?.scrollToRow({ index: messages.length - 1, align: 'end' });
            return;
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        });
    }, [useVirtualization, messages.length]);

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
        if (useVirtualization) {
            const idx = messages.findIndex((m) => m.message_id === highlightedMsgId);
            if (idx >= 0) listRef.current?.scrollToRow({ index: idx, align: 'center' });
            return;
        }
        const el = document.getElementById(`msg-${highlightedMsgId}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
            console.warn('[Trace] message element not in DOM:', highlightedMsgId);
        }
    }, [highlightedMsgId, useVirtualization, messages]);

    // P0: AI 回复完成后 5 秒自动清理搜索来源
    useEffect(() => {
        if (!isAiTyping && searchSources.length > 0) {
            const timer = setTimeout(() => clearSearchSources(), 5000);
            return () => clearTimeout(timer);
        }
    }, [isAiTyping, searchSources, clearSearchSources]);

    // 虚拟列表行渲染（通过闭包引用 messages 和 user）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const RowComponent = useCallback((props: any) => (
        <div style={props.style}>
            <MessageBubble
                message={messages[props.index]}
                isOwn={messages[props.index].sender.id === user?.user_id}
            />
        </div>
    ), [messages, user?.user_id]);

    return (
        <div className="flex flex-col h-full bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* Header — 简洁标题 + LLM 选择器 */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
                <LLMSelector />
            </div>

            {/* Messages 区域 */}
            <div
                ref={(el) => {
                    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                    (containerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                }}
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

                {/* P0: 超过 50 条消息使用虚拟化列表 */}
                {messages.length > 0 && useVirtualization ? (
                    <List
                        listRef={listRef}
                        rowCount={messages.length}
                        rowHeight={(index: number) => estimateRowHeight(messages[index])}
                        rowComponent={RowComponent}
                        rowProps={{}}
                        overscanCount={5}
                        style={{ height: containerHeight, width: '100%' }}
                    />
                ) : (
                    messages.map((msg) => (
                        <MessageBubble
                            key={msg.message_id}
                            message={msg}
                            isOwn={msg.sender.id === user?.user_id}
                        />
                    ))
                )}

                {/* P3: 搜索来源卡片（AI typing 时显示） */}
                {searchSources.length > 0 && (
                    <div className="mb-2 ml-10">
                        <p className="text-[10px] text-emerald-500 font-medium mb-1">🌐 搜索来源</p>
                        <div className="flex flex-wrap gap-1">
                            {searchSources.map((s, i) => (
                                <a
                                    key={i}
                                    href={s.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors max-w-[200px] truncate"
                                    title={s.content}
                                >
                                    <span className="font-medium">[{i+1}]</span>
                                    <span className="truncate">{s.title}</span>
                                </a>
                            ))}
                        </div>
                    </div>
                )}

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

                {/* P2: 支架建议卡片（AI 回复后显示） */}
                {isAiChannel && scaffoldSuggestion && (
                    <div className="px-3 pt-1">
                        <ScaffoldSuggest
                            scaffolds={scaffoldSuggestion.scaffolds}
                            recommendedIndex={scaffoldSuggestion.recommendedIndex}
                            learningState={scaffoldSuggestion.learningState}
                            onUse={(content) => {
                                onSend(content);
                                clearScaffoldSuggestion();
                            }}
                            onDismiss={clearScaffoldSuggestion}
                        />
                    </div>
                )}

                {/* 输入框 */}
                <ChatInput
                    onSend={onSend}
                    isAiChannel={isAiChannel}
                    isDeepThinking={isDeepThinking}
                    onToggleDeepThinking={() => setIsDeepThinking(!isDeepThinking)}
                    isSearchEnabled={isSearchEnabled}
                    onToggleSearch={() => setIsSearchEnabled(!isSearchEnabled)}
                    disabled={disabled}
                />
            </div>
        </div>
    );
};

