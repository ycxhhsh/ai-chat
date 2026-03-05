/**
 * 聊天输入框组件。
 */
import React, { useState } from 'react';
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

    // 同步支架填充的内容
    const currentValue = inputMessage || localInput;

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
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex items-end gap-2 p-3 border-t border-gray-200 bg-white">
            <textarea
                value={currentValue}
                onChange={(e) => {
                    setLocalInput(e.target.value);
                    if (inputMessage) setInputMessage('');
                }}
                onKeyDown={handleKeyDown}
                placeholder={isAiChannel ? '直接输入消息开始对话...' : '输入消息... (@AI 触发AI回复)'}
                disabled={disabled}
                rows={1}
                className="flex-1 resize-none px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all disabled:opacity-50"
            />
            <button
                onClick={handleSend}
                disabled={disabled || !currentValue.trim()}
                className="p-2.5 bg-primary text-white rounded-xl hover:bg-primary-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
                <Send className="w-4 h-4" />
            </button>
        </div>
    );
};
