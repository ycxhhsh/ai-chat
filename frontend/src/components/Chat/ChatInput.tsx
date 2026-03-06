/**
 * 聊天输入框组件 — Sprint 3 现代浮动设计。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send } from 'lucide-react';
import { useScaffoldStore } from '../../store/useScaffoldStore';
import { generateUUID } from '../../utils/uuid';

interface Props {
    onSend: (content: string, metadata?: Record<string, unknown>) => void;
    disabled?: boolean;
    isAiChannel?: boolean;
}

export const ChatInput: React.FC<Props> = ({ onSend, disabled, isAiChannel }) => {
    const { inputMessage, setInputMessage, activeScaffoldId, setActiveScaffold, scaffolds } = useScaffoldStore();
    const [localInput, setLocalInput] = useState('');
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 监听思维导图"用作上下文"事件
    useEffect(() => {
        const handler = (e: Event) => {
            const ctx = (e as CustomEvent).detail as string;
            if (ctx) {
                setLocalInput((prev) => prev ? `${prev}\n\n${ctx}` : ctx);
            }
        };
        window.addEventListener('mindmap-use-context', handler);
        return () => window.removeEventListener('mindmap-use-context', handler);
    }, []);

    // 同步支架填充的内容
    const currentValue = inputMessage || localInput;

    // 自动调整 textarea 高度
    const adjustHeight = useCallback(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }, []);

    useEffect(() => {
        adjustHeight();
    }, [currentValue, adjustHeight]);

    const handleSend = () => {
        const content = currentValue.trim();
        if (!content) return;

        // 构建支架元数据
        const metadata: Record<string, unknown> = {};
        if (activeScaffoldId) {
            const scaffold = scaffolds.find((s) => s.scaffold_id === activeScaffoldId);
            if (scaffold) {
                metadata.is_scaffold_used = true;
                metadata.scaffold_info = {
                    id: scaffold.scaffold_id,
                    name: scaffold.display_name,
                };
            }
        }

        // 生成 request_id 用于消息 ACK
        metadata.request_id = generateUUID();

        onSend(content, metadata);
        setLocalInput('');
        setInputMessage('');
        setActiveScaffold(null);

        // 重置高度
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="p-2">
            <div className="flex items-end gap-2 rounded-2xl bg-gray-50 border border-gray-200 focus-within:border-blue-400 focus-within:bg-white focus-within:shadow-sm transition-all px-3 py-2">
                <textarea
                    ref={textareaRef}
                    value={currentValue}
                    onChange={(e) => {
                        setLocalInput(e.target.value);
                        if (inputMessage) setInputMessage('');
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={isAiChannel ? '输入消息开始对话...' : '输入消息... (@AI 触发AI回复)'}
                    disabled={disabled}
                    rows={1}
                    className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50 leading-relaxed max-h-40"
                />
                <button
                    onClick={handleSend}
                    disabled={disabled || !currentValue.trim()}
                    className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow flex-shrink-0"
                >
                    <Send className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};
