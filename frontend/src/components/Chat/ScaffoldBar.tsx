/**
 * 支架快捷按钮栏 — 精致渐变 pill + 图标标签。
 * 位于聊天输入框上方。
 */
import React, { useState } from 'react';
import { Rocket, Layers, Swords, RotateCcw } from 'lucide-react';
import { useScaffoldStore } from '../../store/useScaffoldStore';
import type { Scaffold } from '../../types';
import { ScaffoldModal } from './ScaffoldModal';

/* ── 支架图标 + 配色映射 ── */
const SCAFFOLD_STYLES: Record<string, { icon: React.ReactNode; color: string; hoverColor: string; borderColor: string }> = {
    '启动': {
        icon: <Rocket className="w-3 h-3" />,
        color: 'text-emerald-600',
        hoverColor: 'hover:bg-emerald-50',
        borderColor: 'border-emerald-200 hover:border-emerald-300',
    },
    '修正': {
        icon: <Layers className="w-3 h-3" />,
        color: 'text-blue-600',
        hoverColor: 'hover:bg-blue-50',
        borderColor: 'border-blue-200 hover:border-blue-300',
    },
    '批判': {
        icon: <Swords className="w-3 h-3" />,
        color: 'text-amber-600',
        hoverColor: 'hover:bg-amber-50',
        borderColor: 'border-amber-200 hover:border-amber-300',
    },
    '反思': {
        icon: <RotateCcw className="w-3 h-3" />,
        color: 'text-violet-600',
        hoverColor: 'hover:bg-violet-50',
        borderColor: 'border-violet-200 hover:border-violet-300',
    },
};

function getStyle(name: string) {
    for (const key of Object.keys(SCAFFOLD_STYLES)) {
        if (name.includes(key)) return SCAFFOLD_STYLES[key];
    }
    return {
        icon: <Rocket className="w-3 h-3" />,
        color: 'text-gray-600',
        hoverColor: 'hover:bg-gray-50',
        borderColor: 'border-gray-200 hover:border-gray-300',
    };
}

/** 判断模板是否需要弹窗（含 ______ 或 （A/B） 占位符） */
function needsModal(template: string): boolean {
    return template.includes('______') || /（[^）]+\/[^）]+）/.test(template);
}

/** 提取短名称（去掉「...支架」等后缀） */
function shortName(name: string): string {
    return name
        .replace(/提示语支架/g, '')
        .replace(/支架/g, '')
        .replace(/ - /g, '·')
        .replace(/\s*-\s*/g, '·')
        .trim();
}

export const ScaffoldBar: React.FC = () => {
    const { scaffolds, setInputMessage, setActiveScaffold } = useScaffoldStore();
    const [activeModal, setActiveModal] = useState<Scaffold | null>(null);

    const activeScaffolds = scaffolds.filter((s) => s.is_active);
    if (activeScaffolds.length === 0) return null;

    const handleClick = (scaffold: Scaffold) => {
        if (needsModal(scaffold.prompt_template)) {
            setActiveModal(scaffold);
        } else {
            setInputMessage(scaffold.prompt_template);
            setActiveScaffold(scaffold.scaffold_id);
        }
    };

    return (
        <>
            <div className="flex gap-1.5 px-3 py-2 overflow-x-auto scrollbar-hide">
                <span className="flex-shrink-0 text-[10px] text-gray-400 self-center mr-0.5">提示语</span>
                {activeScaffolds.map((s) => {
                    const style = getStyle(s.display_name);
                    return (
                        <button
                            key={s.scaffold_id}
                            onClick={() => handleClick(s)}
                            className={`flex-shrink-0 flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white rounded-full border shadow-sm transition-all cursor-pointer active:scale-95 ${style.color} ${style.hoverColor} ${style.borderColor}`}
                        >
                            {style.icon}
                            {shortName(s.display_name)}
                        </button>
                    );
                })}
            </div>

            {activeModal && (
                <ScaffoldModal
                    scaffold={activeModal}
                    onClose={() => setActiveModal(null)}
                    onSubmit={(filled) => {
                        setInputMessage(filled);
                        setActiveScaffold(activeModal.scaffold_id);
                        setActiveModal(null);
                    }}
                />
            )}
        </>
    );
};
