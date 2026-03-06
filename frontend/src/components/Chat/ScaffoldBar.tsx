/**
 * 支架快捷按钮栏 — Sprint 3 水平滚动 pill 标签。
 * 位于聊天输入框上方。
 */
import React, { useState } from 'react';
import { useScaffoldStore } from '../../store/useScaffoldStore';
import type { Scaffold } from '../../types';
import { ScaffoldModal } from './ScaffoldModal';

export const ScaffoldBar: React.FC = () => {
    const { scaffolds, setInputMessage, setActiveScaffold } = useScaffoldStore();
    const [activeModal, setActiveModal] = useState<Scaffold | null>(null);

    const activeScaffolds = scaffolds.filter((s) => s.is_active);
    if (activeScaffolds.length === 0) return null;

    const handleClick = (scaffold: Scaffold) => {
        if (scaffold.prompt_template.includes('______')) {
            setActiveModal(scaffold);
        } else {
            setInputMessage(scaffold.prompt_template);
            setActiveScaffold(scaffold.scaffold_id);
        }
    };

    return (
        <>
            <div className="flex gap-1.5 px-3 py-2 overflow-x-auto scrollbar-hide">
                {activeScaffolds.map((s) => (
                    <button
                        key={s.scaffold_id}
                        onClick={() => handleClick(s)}
                        className="flex-shrink-0 px-3 py-1 text-xs font-medium text-gray-600 bg-white rounded-full border border-gray-200 shadow-sm hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all cursor-pointer"
                    >
                        {s.display_name}
                    </button>
                ))}
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
