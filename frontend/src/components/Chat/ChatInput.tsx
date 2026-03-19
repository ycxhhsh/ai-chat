/**
 * 聊天输入框组件 — 支持引用追问 + @AI 快捷按钮 + @成员提及。
 * 追问时显示引用预览卡片在输入框上方（类 ChatGPT 风格）。
 * @AI 按钮仅在小组频道显示，点击后快捷插入 `@AI ` 文本。
 * 输入 @ 时弹出成员下拉列表（含 @AI）。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, X, MessageSquareQuote, Bot, Brain, Globe } from 'lucide-react';
import { useScaffoldStore } from '../../store/useScaffoldStore';
import { useGroupStore } from '../../store/useGroupStore';
import { generateUUID } from '../../utils/uuid';
import { api } from '../../api';
import { MentionDropdown } from './MentionDropdown';

interface Props {
    onSend: (content: string, metadata?: Record<string, unknown>) => void;
    disabled?: boolean;
    isAiChannel?: boolean;
    isDeepThinking?: boolean;
    onToggleDeepThinking?: () => void;
    isSearchEnabled?: boolean;
    onToggleSearch?: () => void;
}

interface Member {
    user_id: string;
    name: string;
    role: string;
}

export const ChatInput: React.FC<Props> = ({ onSend, disabled, isAiChannel, isDeepThinking, onToggleDeepThinking, isSearchEnabled, onToggleSearch }) => {
    const { inputMessage, setInputMessage, activeScaffoldId, setActiveScaffold, scaffolds } = useScaffoldStore();
    const { currentGroupId } = useGroupStore();
    const [localInput, setLocalInput] = useState('');
    const [quotedText, setQuotedText] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // @成员 下拉列表状态
    const [showMention, setShowMention] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionMembers, setMentionMembers] = useState<Member[]>([]);

    // 加载小组成员
    useEffect(() => {
        if (!isAiChannel && currentGroupId) {
            api.groups.members(currentGroupId).then(setMentionMembers).catch(() => {});
        }
    }, [currentGroupId, isAiChannel]);

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

    // 监听 AI 追问事件 → 设置引用文本（显示为预览卡片）
    useEffect(() => {
        const handler = (e: Event) => {
            const quoted = (e as CustomEvent).detail as string;
            if (quoted) {
                setQuotedText(quoted);
                textareaRef.current?.focus();
            }
        };
        window.addEventListener('chat-follow-up', handler);
        return () => window.removeEventListener('chat-follow-up', handler);
    }, []);

    // 监听 AI 选项点击事件 → 注入到输入框（学生可编辑后再发送）
    useEffect(() => {
        const handler = (e: Event) => {
            const optionText = (e as CustomEvent).detail as string;
            if (optionText) {
                setLocalInput(optionText);
                if (inputMessage) setInputMessage('');
                textareaRef.current?.focus();
            }
        };
        window.addEventListener('chat-option-click', handler);
        return () => window.removeEventListener('chat-option-click', handler);
    }, [inputMessage, setInputMessage]);

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

        // 传递引用文本给后端
        if (quotedText) {
            metadata.quoted_text = quotedText;
        }

        // 生成 request_id 用于消息 ACK
        metadata.request_id = generateUUID();

        // 检测 @mentions
        const mentions = content.match(/@(\S+)/g);
        if (mentions) {
            metadata.mentions = mentions.map((m) => m.slice(1));
        }

        // P2: 深度思考模式
        if (isDeepThinking) {
            metadata.is_deep_thinking = true;
        }

        // P3: 联网搜索
        if (isSearchEnabled) {
            metadata.enable_search = true;
        }

        onSend(content, metadata);
        setLocalInput('');
        setInputMessage('');
        setActiveScaffold(null);
        setQuotedText(null);
        setShowMention(false);

        // 重置高度
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // 当 @mention 下拉开启时，不拦截 Enter（由下拉组件处理）
        if (showMention) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const val = e.target.value;
        setLocalInput(val);
        if (inputMessage) setInputMessage('');

        // 检测 @ 触发提及下拉
        const cursorPos = e.target.selectionStart;
        const textBeforeCursor = val.slice(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@(\S*)$/);

        if (atMatch && !isAiChannel) {
            setShowMention(true);
            setMentionFilter(atMatch[1]);
        } else {
            setShowMention(false);
            setMentionFilter('');
        }
    };

    const handleMentionSelect = (text: string) => {
        // 替换 @filter 为完整的 @Name
        const val = currentValue;
        const cursorPos = textareaRef.current?.selectionStart || val.length;
        const textBeforeCursor = val.slice(0, cursorPos);
        const atIndex = textBeforeCursor.lastIndexOf('@');

        if (atIndex >= 0) {
            const newValue = val.slice(0, atIndex) + text + val.slice(cursorPos);
            setLocalInput(newValue);
            if (inputMessage) setInputMessage('');
        }

        setShowMention(false);
        setMentionFilter('');
        textareaRef.current?.focus();
    };

    // @AI 快捷按钮
    const handleAtAiClick = () => {
        const pos = textareaRef.current?.selectionStart || currentValue.length;
        const newValue = currentValue.slice(0, pos) + '@AI ' + currentValue.slice(pos);
        setLocalInput(newValue);
        if (inputMessage) setInputMessage('');
        textareaRef.current?.focus();
    };

    return (
        <div className="p-2">
            {/* ── 引用预览卡片（ChatGPT 风格） ── */}
            {quotedText && (
                <div className="flex items-start gap-2 mb-1.5 px-1 animate-[slideDown_150ms_ease-out]">
                    <div className="flex-1 flex items-start gap-2 px-3 py-2 bg-violet-50 border border-violet-200 rounded-xl text-xs">
                        <MessageSquareQuote className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-violet-500 font-medium mb-0.5">追问引用</p>
                            <p className="text-gray-600 leading-relaxed line-clamp-3">{quotedText}</p>
                        </div>
                        <button
                            onClick={() => setQuotedText(null)}
                            className="p-0.5 hover:bg-violet-100 rounded transition-colors flex-shrink-0"
                            title="取消引用"
                        >
                            <X className="w-3 h-3 text-violet-400" />
                        </button>
                    </div>
                </div>
            )}

            {/* ── @成员下拉列表 ── */}
            {showMention && !isAiChannel && (
                <MentionDropdown
                    members={mentionMembers}
                    filter={mentionFilter}
                    onSelect={handleMentionSelect}
                    onClose={() => setShowMention(false)}
                    anchorRef={textareaRef}
                />
            )}

            {/* ── 输入区域 ── */}
            <div className="flex items-end gap-2 rounded-2xl bg-gray-50 border border-gray-200 focus-within:border-blue-400 focus-within:bg-white focus-within:shadow-sm transition-all px-3 py-2">
                {/* @AI 快捷按钮（仅小组频道） */}
                {!isAiChannel && (
                    <button
                        onClick={handleAtAiClick}
                        className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-full transition-colors flex-shrink-0 border border-violet-200"
                        title="呼叫 AI 助教"
                    >
                        <Bot className="w-3 h-3" />
                        @AI
                    </button>
                )}
                <textarea
                    ref={textareaRef}
                    value={currentValue}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder={
                        disabled 
                            ? (isAiChannel ? '对话已禁用...' : '👈 请先在左侧选择或创建小组')
                            : quotedText ? '输入你的追问...' : (isAiChannel ? '输入消息开始对话...' : '输入消息... (输入 @ 提及成员 或 @AI 呼叫助教)')
                    }
                    disabled={disabled}
                    rows={1}
                    className="flex-1 resize-none bg-transparent border-none outline-none text-sm text-gray-900 placeholder-gray-400 disabled:opacity-50 leading-relaxed max-h-40"
                />
                {/* P2: 深度思考 Toggle（仅 AI 频道） */}
                {isAiChannel && onToggleDeepThinking && (
                    <button
                        onClick={onToggleDeepThinking}
                        className={`p-1.5 rounded-lg transition-all flex-shrink-0 ${
                            isDeepThinking
                                ? 'bg-violet-100 text-violet-600 ring-1 ring-violet-300'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                        }`}
                        title={isDeepThinking ? '关闭深度思考' : '开启深度思考'}
                    >
                        <Brain className="w-4 h-4" />
                    </button>
                )}
                {/* P3: 联网搜索 Toggle */}
                {isAiChannel && onToggleSearch && (
                    <button
                        onClick={onToggleSearch}
                        className={`p-1.5 rounded-lg transition-all flex-shrink-0 ${
                            isSearchEnabled
                                ? 'bg-emerald-100 text-emerald-600 ring-1 ring-emerald-300'
                                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                        }`}
                        title={isSearchEnabled ? '关闭联网搜索' : '开启联网搜索'}
                    >
                        <Globe className="w-4 h-4" />
                    </button>
                )}
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
