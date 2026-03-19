/**
 * 消息气泡组件。
 * 支持 HTML5 拖拽到思维导图画布（仅通过手柄区域）。
 * AI 消息支持文本选中 + Gemini 风格操作栏 + [OPTIONS] 可点选。
 */
import React, { useCallback, useEffect, useState, useMemo } from 'react';
import type { ChatMessage } from '../../types';
import { useChatStore } from '../../store/useChatStore';
import clsx from 'clsx';
import { Check, CheckCheck, AlertCircle, GripVertical, Copy, MessageSquareQuote, ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/* ── OPTIONS 解析器 ── */
const parseOptions = (text: string): { content: string; options: string[] } => {
    const match = text.match(/\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/);
    if (!match) return { content: text, options: [] };
    const content = text.replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/, '').trim();
    const options = match[1]
        .trim()
        .split('\n')
        .map((line) => line.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
    return { content, options };
};

/* ── <thinking> 解析器 ── */
const parseThinking = (text: string): { thinking: string | null; answer: string } => {
    const match = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
    if (!match) return { thinking: null, answer: text };
    const thinking = match[1].trim();
    const answer = text.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
    return { thinking, answer };
};

interface Props {
    message: ChatMessage;
    isOwn: boolean;
}

export const MessageBubble: React.FC<Props> = React.memo(({ message, isOwn }) => {
    const { sender, content, timing, metadata_info, status } = message;
    const isAi = sender.role === 'ai';
    const isTeacher = sender.role === 'teacher';
    const highlightedMsgId = useChatStore((s) => s.highlightedMsgId);
    const setHighlightedMsgId = useChatStore((s) => s.setHighlightedMsgId);

    const [isHighlighted, setIsHighlighted] = useState(false);
    const [copied, setCopied] = useState(false);

    // AI 消息解析 [OPTIONS] 和 <thinking>
    const { content: displayContent, options } = useMemo(
        () => (isAi ? parseOptions(content) : { content, options: [] }),
        [content, isAi]
    );
    const { thinking, answer: answerContent } = useMemo(
        () => (isAi ? parseThinking(displayContent) : { thinking: null, answer: displayContent }),
        [displayContent, isAi]
    );
    const [thinkingOpen, setThinkingOpen] = useState(false);
    // 溯源高亮：当 highlightedMsgId 匹配时闪烁
    useEffect(() => {
        if (highlightedMsgId === message.message_id) {
            setIsHighlighted(true);
            const timer = setTimeout(() => {
                setIsHighlighted(false);
                setHighlightedMsgId(null);
            }, 2500);
            return () => clearTimeout(timer);
        }
    }, [highlightedMsgId, message.message_id, setHighlightedMsgId]);

    // 拖拽开始：传递消息数据到思维导图（仅手柄触发）
    const handleDragStart = useCallback(
        (e: React.DragEvent) => {
            const payload = JSON.stringify({
                text: content,
                role: sender.role,
                senderName: sender.name,
                message_id: message.message_id,
            });
            e.dataTransfer.setData('application/mindmap-message', payload);
            e.dataTransfer.effectAllowed = 'copy';
        },
        [content, sender, message.message_id]
    );

    // 获取当前选中的文本（优先选中部分，回退整条消息）
    const getSelectedOrFullText = useCallback(() => {
        const sel = window.getSelection();
        if (sel && sel.toString().trim().length > 0) {
            // 检查选中区域是否在当前消息气泡内
            const msgEl = document.getElementById(`msg-${message.message_id}`);
            if (msgEl && sel.anchorNode && msgEl.contains(sel.anchorNode)) {
                return sel.toString().trim();
            }
        }
        return content;
    }, [content, message.message_id]);

    // 复制：选中文本 or 全文
    const handleCopy = useCallback(async () => {
        const textToCopy = getSelectedOrFullText();
        try {
            await navigator.clipboard.writeText(textToCopy);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = textToCopy;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }, [getSelectedOrFullText]);

    // 追问：选中文本 or 截断全文
    const handleFollowUp = useCallback(() => {
        const text = getSelectedOrFullText();
        const quoted = text.length > 150 ? text.slice(0, 150) + '...' : text;
        window.dispatchEvent(
            new CustomEvent('chat-follow-up', { detail: quoted })
        );
    }, [getSelectedOrFullText]);

    // 选项点击：发送 CustomEvent
    const handleOptionClick = useCallback((optionText: string) => {
        window.dispatchEvent(
            new CustomEvent('chat-option-click', { detail: optionText })
        );
    }, []);

    return (
        <div
            id={`msg-${message.message_id}`}
            className={clsx(
                'flex gap-2.5 mb-3 group/msg',
                isOwn && 'flex-row-reverse',
                isHighlighted && 'ring-2 ring-yellow-400 bg-yellow-50/60 rounded-2xl transition-all duration-500',
            )}
        >
            {/* 头像 */}
            <div
                className={clsx(
                    'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0',
                    isAi && 'bg-gradient-to-br from-violet-500 to-purple-600 text-white',
                    isTeacher && 'bg-gray-900 text-white',
                    isOwn && 'bg-primary text-white',
                    !isAi && !isTeacher && !isOwn && 'bg-gray-200 text-gray-700'
                )}
            >
                {isAi ? 'AI' : sender.name?.charAt(0) || '?'}
            </div>

            {/* 内容 */}
            <div className={clsx('max-w-[70%]', isOwn && 'items-end')}>
                {/* 发送者名称 */}
                {!isOwn && (
                    <p className="text-xs text-gray-400 mb-1">
                        {sender.name}
                        {isAi && (
                            <span className="ml-1 text-violet-400">AI 助教</span>
                        )}
                        {isTeacher && (
                            <span className="ml-1 text-amber-500">教师</span>
                        )}
                    </p>
                )}

                {/* 消息体 — 不再整体 draggable，支持文本选中 */}
                <div
                    className={clsx(
                        'relative px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed',
                        isAi ? 'select-text cursor-text' : 'cursor-default',
                        isOwn
                            ? 'bg-primary text-white rounded-br-md'
                            : isAi
                                ? 'bg-violet-50 text-gray-800 border border-violet-100 rounded-bl-md'
                                : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'
                    )}
                >
                    {/* 拖拽手柄 — 仅手柄区域可拖拽 */}
                    <div
                        draggable
                        onDragStart={handleDragStart}
                        className="absolute -left-5 top-1/2 -translate-y-1/2 opacity-0 group-hover/msg:opacity-60 transition-opacity cursor-grab active:cursor-grabbing"
                        title="拖拽到思维导图"
                    >
                        <GripVertical className="w-3.5 h-3.5 text-gray-300" />
                    </div>

                    {/* 支架标记 */}
                    {metadata_info?.is_scaffold_used && metadata_info?.scaffold_info && (
                        <span className="inline-block text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full mb-1.5">
                            📎 {metadata_info.scaffold_info.name}
                        </span>
                    )}

                    {isAi ? (
                        <div>
                            {/* P2: 思考过程折叠卡片 */}
                            {thinking && (
                                <div className="mb-2">
                                    <button
                                        onClick={() => setThinkingOpen(!thinkingOpen)}
                                        className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-700 transition-colors"
                                    >
                                        {thinkingOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                        <span>📝 思考过程</span>
                                    </button>
                                    {thinkingOpen && (
                                        <div className="mt-1 px-3 py-2 bg-violet-50/50 border border-violet-100 rounded-lg text-[11px] text-gray-500 leading-relaxed">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {thinking}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="prose prose-sm prose-blue max-w-none leading-relaxed [&>p]:mb-1.5 [&>p:last-child]:mb-0 [&>ul]:mb-1.5 [&>ol]:mb-1.5 [&_li]:mb-0.5 [&_code]:bg-violet-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {answerContent}
                                </ReactMarkdown>
                            </div>
                        </div>
                    ) : (
                        <p className="whitespace-pre-wrap">{content}</p>
                    )}
                </div>

                {/* ── AI 可点击选项按钮组 ── */}
                {isAi && options.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {options.map((opt, i) => (
                            <button
                                key={i}
                                onClick={() => handleOptionClick(opt)}
                                className="px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full hover:bg-violet-100 hover:border-violet-300 transition-all cursor-pointer"
                            >
                                {opt}
                            </button>
                        ))}
                    </div>
                )}

                {/* ── 底部区域：时间 + 状态 + 操作栏 ── */}
                <div className={clsx(
                    'flex items-center gap-1.5 mt-0.5 flex-wrap',
                    isOwn ? 'justify-end' : 'justify-start'
                )}>
                    {/* 时间 */}
                    <p className="text-[10px] text-gray-300">
                        {new Date(timing.absolute_time).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </p>

                    {/* 消息发送状态 */}
                    {isOwn && status === 'sending' && (
                        <Check className="w-3 h-3 text-gray-300" />
                    )}
                    {isOwn && status === 'sent' && (
                        <CheckCheck className="w-3 h-3 text-blue-400" />
                    )}
                    {isOwn && status === 'failed' && (
                        <AlertCircle className="w-3 h-3 text-red-400" />
                    )}

                    {/* ── Gemini 风格操作栏（AI 消息专用） ── */}
                    {isAi && (
                        <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                            {/* 复制 */}
                            <button
                                onClick={handleCopy}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-md transition-colors"
                                title="复制消息"
                            >
                                {copied ? (
                                    <>
                                        <Check className="w-3 h-3 text-green-500" />
                                        <span className="text-green-500 font-medium">已复制</span>
                                    </>
                                ) : (
                                    <>
                                        <Copy className="w-3 h-3" />
                                        <span>复制</span>
                                    </>
                                )}
                            </button>
                            <span className="text-gray-200">|</span>
                            {/* 追问 */}
                            <button
                                onClick={handleFollowUp}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-violet-600 hover:bg-violet-50 rounded-md transition-colors"
                                title="追问此消息"
                            >
                                <MessageSquareQuote className="w-3 h-3" />
                                <span>追问</span>
                            </button>
                        </div>
                    )}

                    {/* 非 AI 消息保留原有 hover 复制按钮 */}
                    {!isAi && (
                        <button
                            onClick={handleCopy}
                            className="opacity-0 group-hover/msg:opacity-60 transition-opacity hover:opacity-100 p-0.5 flex items-center gap-0.5"
                            title="复制消息"
                        >
                            {copied ? (
                                <>
                                    <Check className="w-3 h-3 text-green-500" />
                                    <span className="text-[10px] text-green-500 font-medium">已复制</span>
                                </>
                            ) : (
                                <Copy className="w-3 h-3 text-gray-400" />
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
});
