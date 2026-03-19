/**
 * 学习支架建议卡片组 — AI 判断学生需要时展示。
 * 使用已有支架（启动/修正/批判/反思）的预填结果。
 * 推荐支架高亮紫色边框 + ⭐ 标记。
 * 点击卡片即把预填内容插入到输入框。
 */
import React from 'react';
import { Rocket, Layers, Swords, RotateCcw, Star } from 'lucide-react';
import clsx from 'clsx';

interface Scaffold {
    scaffold_id: string;
    label: string;
    content: string;
}

interface Props {
    scaffolds: Scaffold[];
    recommendedIndex: number;
    learningState: string;
    onUse: (content: string) => void;
    onDismiss: () => void;
}

/* 根据支架名称匹配图标和配色 */
const SCAFFOLD_STYLES: { keyword: string; icon: React.ElementType; bg: string; border: string; text: string; iconColor: string }[] = [
    { keyword: '启动', icon: Rocket, bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', iconColor: 'text-emerald-500' },
    { keyword: '修正', icon: Layers, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', iconColor: 'text-blue-500' },
    { keyword: '批判', icon: Swords, bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', iconColor: 'text-amber-500' },
    { keyword: '反思', icon: RotateCcw, bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', iconColor: 'text-violet-500' },
];

function getStyle(label: string) {
    const match = SCAFFOLD_STYLES.find((s) => label.includes(s.keyword));
    return match || SCAFFOLD_STYLES[0];
}

const STATE_LABELS: Record<string, string> = {
    confused: '😵 困惑中',
    exploring: '🔍 探索中',
    summarizing: '📋 总结中',
    deepening: '🔬 深入中',
};

/** 提取短名称 */
function shortName(name: string): string {
    return name
        .replace(/提示语支架/g, '')
        .replace(/支架/g, '')
        .replace(/ - /g, '·')
        .replace(/\s*-\s*/g, '·')
        .trim();
}

export const ScaffoldSuggest: React.FC<Props> = ({
    scaffolds,
    recommendedIndex,
    learningState,
    onUse,
    onDismiss,
}) => {
    return (
        <div className="animate-[slideUp_200ms_ease-out] mt-2 mb-1">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-1 mb-1.5">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-500">💡 推荐学习支架</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium">
                        {STATE_LABELS[learningState] || learningState}
                    </span>
                </div>
                <button
                    onClick={onDismiss}
                    className="text-[10px] text-gray-400 hover:text-gray-600 transition-colors"
                >
                    收起
                </button>
            </div>

            {/* 支架卡片 */}
            <div className="grid grid-cols-2 gap-1.5">
                {scaffolds.map((s, i) => {
                    const isRecommended = i === recommendedIndex;
                    const style = getStyle(s.label);
                    const Icon = style.icon;

                    return (
                        <button
                            key={s.scaffold_id || i}
                            onClick={() => onUse(s.content)}
                            className={clsx(
                                'relative text-left p-2.5 rounded-xl border transition-all hover:shadow-sm group',
                                isRecommended
                                    ? 'border-violet-300 bg-violet-50 ring-1 ring-violet-200'
                                    : `${style.border} ${style.bg} hover:border-gray-300`
                            )}
                        >
                            {isRecommended && (
                                <Star className="absolute top-1.5 right-1.5 w-3 h-3 text-violet-500 fill-violet-400" />
                            )}
                            <div className="flex items-center gap-1.5 mb-1">
                                <Icon className={clsx('w-3.5 h-3.5', isRecommended ? 'text-violet-500' : style.iconColor)} />
                                <span className={clsx('text-[11px] font-medium', isRecommended ? 'text-violet-700' : style.text)}>
                                    {shortName(s.label)}
                                </span>
                            </div>
                            <p className="text-[11px] text-gray-600 leading-relaxed line-clamp-3">
                                {s.content}
                            </p>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
