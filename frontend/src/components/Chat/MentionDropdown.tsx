/**
 * @提及下拉列表 — 输入 @ 时弹出成员选择菜单。
 * 第一项固定为 @AI（紫色高亮），其余为小组成员。
 * 支持键盘上下选择 + Enter 确认 + Esc 关闭。
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bot } from 'lucide-react';
import clsx from 'clsx';

interface Member {
    user_id: string;
    name: string;
    role: string;
}

interface Props {
    members: Member[];
    filter: string;           // @ 后输入的过滤文本
    onSelect: (text: string) => void;
    onClose: () => void;
    anchorRef: React.RefObject<HTMLElement | null>;
}

export const MentionDropdown: React.FC<Props> = ({
    members,
    filter,
    onSelect,
    onClose,
    anchorRef,
}) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    // 构建选项列表：固定 @AI 在首位 + 过滤后的成员
    const aiOption = { user_id: '__ai__', name: 'AI', role: 'ai' };
    const allOptions = [aiOption, ...members];
    const filtered = filter
        ? allOptions.filter((m) =>
            m.name.toLowerCase().includes(filter.toLowerCase())
        )
        : allOptions;

    // 联动：filter 变化时重置选中
    useEffect(() => {
        setSelectedIndex(0);
    }, [filter]);

    // 键盘事件（挂载到 window 以捕获 textarea 内的按键）
    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            if (filtered.length === 0) return;

            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex((i) => (i + 1) % filtered.length);
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
                    break;
                case 'Enter':
                case 'Tab':
                    e.preventDefault();
                    onSelect(`@${filtered[selectedIndex].name} `);
                    break;
                case 'Escape':
                    e.preventDefault();
                    onClose();
                    break;
            }
        },
        [filtered, selectedIndex, onSelect, onClose]
    );

    useEffect(() => {
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [handleKeyDown]);

    // 自动滚动到选中项
    useEffect(() => {
        const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
        el?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    if (filtered.length === 0) return null;

    // 定位：显示在 anchor 上方
    const pos = anchorRef.current?.getBoundingClientRect();

    return (
        <div
            ref={listRef}
            className="fixed z-50 bg-white rounded-xl shadow-lg border border-gray-200 py-1 max-h-48 overflow-y-auto min-w-[180px]"
            style={{
                bottom: pos ? window.innerHeight - pos.top + 8 : undefined,
                left: pos ? pos.left : undefined,
            }}
        >
            {filtered.map((m, i) => {
                const isAi = m.user_id === '__ai__';
                return (
                    <button
                        key={m.user_id}
                        onClick={() => onSelect(`@${m.name} `)}
                        onMouseEnter={() => setSelectedIndex(i)}
                        className={clsx(
                            'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                            i === selectedIndex ? 'bg-gray-100' : 'hover:bg-gray-50'
                        )}
                    >
                        {isAi ? (
                            <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center">
                                <Bot className="w-3.5 h-3.5 text-violet-600" />
                            </div>
                        ) : (
                            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-medium">
                                {m.name.charAt(0)}
                            </div>
                        )}
                        <span className={clsx(
                            'flex-1 text-left truncate',
                            isAi ? 'text-violet-600 font-medium' : 'text-gray-700'
                        )}>
                            {m.name}
                        </span>
                        {isAi && (
                            <span className="text-[10px] text-violet-400 bg-violet-50 px-1.5 py-0.5 rounded">AI 助教</span>
                        )}
                        {m.role === 'admin' && !isAi && (
                            <span className="text-[10px] text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">组长</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};
