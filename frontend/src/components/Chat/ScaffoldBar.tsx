/**
 * 支架快捷按钮栏。
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
            <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-gray-100 bg-gray-50/50">
                {activeScaffolds.map((s) => (
                    <button
                        key={s.scaffold_id}
                        onClick={() => handleClick(s)}
                        className="flex-shrink-0 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-full hover:bg-primary-light hover:text-primary hover:border-primary transition-all"
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
