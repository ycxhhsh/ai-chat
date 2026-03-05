/**
 * 消息气泡组件。
 */
import React from 'react';
import type { ChatMessage } from '../../types';
import clsx from 'clsx';
import { Check, CheckCheck, AlertCircle } from 'lucide-react';

interface Props {
    message: ChatMessage;
    isOwn: boolean;
}

export const MessageBubble: React.FC<Props> = ({ message, isOwn }) => {
    const { sender, content, timing, metadata_info, status } = message;
    const isAi = sender.role === 'ai';
    const isTeacher = sender.role === 'teacher';

    return (
        <div className={clsx('flex gap-2.5 mb-3', isOwn && 'flex-row-reverse')}>
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
                        'px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed',
                        isOwn
                            ? 'bg-primary text-white rounded-br-md'
                            : isAi
                                ? 'bg-violet-50 text-gray-800 border border-violet-100 rounded-bl-md'
                                : 'bg-white text-gray-800 border border-gray-200 rounded-bl-md'
                    )}
                >
                    {/* 支架标记 */}
                    {metadata_info?.is_scaffold_used && metadata_info?.scaffold_info && (
                        <span className="inline-block text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full mb-1.5">
                            📎 {metadata_info.scaffold_info.name}
                        </span>
                    )}

                    <p className="whitespace-pre-wrap">{content}</p>
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
                    {/* P0-1: 消息发送状态指示 */}
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
