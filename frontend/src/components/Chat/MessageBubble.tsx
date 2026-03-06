/**
 * 消息气泡组件。
 * 支持 HTML5 拖拽到思维导图画布。
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { ChatMessage } from '../../types';
import { useChatStore } from '../../store/useChatStore';
import clsx from 'clsx';
import { Check, CheckCheck, AlertCircle, GripVertical } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
    message: ChatMessage;
    isOwn: boolean;
}

export const MessageBubble: React.FC<Props> = ({ message, isOwn }) => {
    const { sender, content, timing, metadata_info, status } = message;
    const isAi = sender.role === 'ai';
    const isTeacher = sender.role === 'teacher';
    const highlightedMsgId = useChatStore((s) => s.highlightedMsgId);
    const setHighlightedMsgId = useChatStore((s) => s.setHighlightedMsgId);

    const [isHighlighted, setIsHighlighted] = useState(false);

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

    // 拖拽开始：传递消息数据到思维导图
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

    return (
        <div
            id={`msg-${message.message_id}`}
            className={clsx(
                'flex gap-2.5 mb-3 group/msg',
                isOwn && 'flex-row-reverse',
                isHighlighted && 'ring-2 ring-yellow-400 bg-yellow-50/60 rounded-2xl transition-all duration-500',
            )}
            draggable
            onDragStart={handleDragStart}
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

                {/* 消息体 */}
                <div
                    className={clsx(
                        'relative px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed cursor-grab active:cursor-grabbing',
                        isOwn
                            ? 'bg-primary text-white rounded-br-md'
                            : isAi
                                ? 'bg-violet-50 text-gray-800 border border-violet-100 rounded-bl-md'
                                : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'
                    )}
                >
                    {/* 拖拽提示图标 */}
                    <GripVertical className="absolute -left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300 opacity-0 group-hover/msg:opacity-60 transition-opacity" />

                    {/* 支架标记 */}
                    {metadata_info?.is_scaffold_used && metadata_info?.scaffold_info && (
                        <span className="inline-block text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full mb-1.5">
                            📎 {metadata_info.scaffold_info.name}
                        </span>
                    )}

                    {isAi ? (
                        <div className="prose prose-sm prose-blue max-w-none leading-relaxed [&>p]:mb-1.5 [&>p:last-child]:mb-0 [&>ul]:mb-1.5 [&>ol]:mb-1.5 [&_li]:mb-0.5 [&_code]:bg-violet-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {content}
                            </ReactMarkdown>
                        </div>
                    ) : (
                        <p className="whitespace-pre-wrap">{content}</p>
                    )}
                </div>

                {/* 时间 + 消息状态 */}
                <div className={clsx(
                    'flex items-center gap-1 mt-0.5',
                    isOwn ? 'justify-end' : 'justify-start'
                )}>
                    <p className="text-[10px] text-gray-300">
                        {new Date(timing.absolute_time).toLocaleTimeString('zh-CN', {
                            hour: '2-digit',
                            minute: '2-digit',
                        })}
                    </p>
                    {isOwn && status === 'sending' && (
                        <Check className="w-3 h-3 text-gray-300" />
                    )}
                    {isOwn && status === 'sent' && (
                        <CheckCheck className="w-3 h-3 text-blue-400" />
                    )}
                    {isOwn && status === 'failed' && (
                        <AlertCircle className="w-3 h-3 text-red-400" />
                    )}
                </div>
            </div>
        </div>
    );
};
