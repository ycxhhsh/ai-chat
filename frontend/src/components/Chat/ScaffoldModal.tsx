/**
 * 填空支架弹窗 — 精致卡片设计。
 * 支持两种占位符：
 * - `______` → 文本输入框（自动聚焦 + 淡蓝底）
 * - `（选项A/选项B/...）` → 按钮组
 */
import React, { useState, useRef, useEffect } from 'react';
import { X, Sparkles } from 'lucide-react';
import type { Scaffold } from '../../types';

interface Props {
    scaffold: Scaffold;
    onClose: () => void;
    onSubmit: (filledContent: string) => void;
}

/* ── 占位符类型 ── */
type Placeholder =
    | { type: 'blank'; index: number }
    | { type: 'choice'; options: string[]; raw: string };

/** 解析模板，提取 ______ 和 （A/B/C） 占位符 */
function parsePlaceholders(template: string): { parts: string[]; placeholders: Placeholder[] } {
    const regex = /______|（([^）]+\/[^）]+)）/g;
    const parts: string[] = [];
    const placeholders: Placeholder[] = [];
    let lastIndex = 0;
    let blankIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(template)) !== null) {
        parts.push(template.slice(lastIndex, match.index));
        if (match[0] === '______') {
            placeholders.push({ type: 'blank', index: blankIdx++ });
        } else {
            const options = match[1].split('/').map((s) => s.trim()).filter(Boolean);
            placeholders.push({ type: 'choice', options, raw: match[0] });
        }
        lastIndex = regex.lastIndex;
    }
    parts.push(template.slice(lastIndex));
    return { parts, placeholders };
}

export const ScaffoldModal: React.FC<Props> = ({ scaffold, onClose, onSubmit }) => {
    const { parts, placeholders } = parsePlaceholders(scaffold.prompt_template);
    const backdropRef = useRef<HTMLDivElement>(null);

    const blankCount = placeholders.filter((p) => p.type === 'blank').length;
    const [blankAnswers, setBlankAnswers] = useState<string[]>(Array(blankCount).fill(''));
    const [choiceSelections, setChoiceSelections] = useState<Record<number, string>>({});

    // 点击蒙层关闭
    useEffect(() => {
        const el = backdropRef.current;
        if (!el) return;
        const handler = (e: MouseEvent) => {
            if (e.target === el) onClose();
        };
        el.addEventListener('click', handler);
        return () => el.removeEventListener('click', handler);
    }, [onClose]);

    const handleSubmit = () => {
        let result = scaffold.prompt_template;
        let bi = 0;
        result = result.replace(/______/g, () => blankAnswers[bi++] || '______');
        placeholders.forEach((p, i) => {
            if (p.type === 'choice') {
                const selected = choiceSelections[i] || p.options[0];
                result = result.replace(p.raw, selected);
            }
        });
        onSubmit(result);
    };

    // 检查是否所有必填项都已填写
    const allBlanksFilled = blankAnswers.every((a) => a.trim().length > 0);

    return (
        <div
            ref={backdropRef}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-[fadeIn_150ms_ease-out]"
        >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col animate-[slideUp_200ms_ease-out] ring-1 ring-black/5">
                {/* Header — 渐变顶栏 */}
                <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-blue-50 to-violet-50 rounded-t-2xl border-b border-gray-100 flex-shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-violet-500 rounded-lg flex items-center justify-center shadow-sm">
                            <Sparkles className="w-3.5 h-3.5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-gray-900">
                                {scaffold.display_name.replace(/提示语支架/g, '').replace(/支架/g, '').trim()}
                            </h3>
                            <p className="text-[10px] text-gray-400">填写空白处生成提示语</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/80 rounded-lg transition-colors"
                    >
                        <X className="w-4 h-4 text-gray-400" />
                    </button>
                </div>

                {/* Content — 引导式填空 */}
                <div className="px-5 py-4 overflow-y-auto flex-1 space-y-1">
                    {parts.map((part, i) => (
                        <div key={i}>
                            {part.trim() && (
                                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                                    {part.trim()}
                                </p>
                            )}
                            {i < placeholders.length && (() => {
                                const ph = placeholders[i];
                                if (ph.type === 'blank') {
                                    return (
                                        <div className="my-2">
                                            <input
                                                type="text"
                                                value={blankAnswers[ph.index]}
                                                onChange={(e) => {
                                                    const newAnswers = [...blankAnswers];
                                                    newAnswers[ph.index] = e.target.value;
                                                    setBlankAnswers(newAnswers);
                                                }}
                                                placeholder={`在此填写...`}
                                                className="w-full px-3 py-2.5 bg-blue-50/50 border border-blue-200 rounded-xl text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-300 focus:bg-white transition-all"
                                                autoFocus={ph.index === 0}
                                            />
                                        </div>
                                    );
                                }
                                if (ph.type === 'choice') {
                                    const selected = choiceSelections[i] || '';
                                    return (
                                        <div className="flex gap-2 my-2">
                                            {ph.options.map((opt) => (
                                                <button
                                                    key={opt}
                                                    type="button"
                                                    onClick={() =>
                                                        setChoiceSelections((prev) => ({
                                                            ...prev,
                                                            [i]: opt,
                                                        }))
                                                    }
                                                    className={`px-4 py-2 text-xs font-medium rounded-xl border-2 transition-all ${selected === opt
                                                            ? 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-200'
                                                            : 'bg-white text-gray-600 border-gray-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300'
                                                        }`}
                                                >
                                                    {opt}
                                                </button>
                                            ))}
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    ))}
                </div>

                {/* Footer — 进度指示 + 操作按钮 */}
                <div className="flex items-center justify-between px-5 py-3 bg-gray-50/80 border-t border-gray-100 rounded-b-2xl flex-shrink-0">
                    <p className="text-[10px] text-gray-400">
                        {blankCount > 0 && (
                            <>已填 {blankAnswers.filter((a) => a.trim()).length}/{blankCount} 处</>
                        )}
                    </p>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-medium text-gray-500 bg-white rounded-xl border border-gray-200 hover:bg-gray-100 transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!allBlanksFilled}
                            className="px-5 py-2 text-xs font-medium text-white bg-gradient-to-r from-blue-600 to-violet-600 rounded-xl hover:from-blue-700 hover:to-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow"
                        >
                            ✨ 生成
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
