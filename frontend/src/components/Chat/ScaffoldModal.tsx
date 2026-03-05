/**
 * 填空支架弹窗。
 */
import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { Scaffold } from '../../types';

interface Props {
    scaffold: Scaffold;
    onClose: () => void;
    onSubmit: (filledContent: string) => void;
}

export const ScaffoldModal: React.FC<Props> = ({ scaffold, onClose, onSubmit }) => {
    const blanks = scaffold.prompt_template.match(/______/g) || [];
    const [answers, setAnswers] = useState<string[]>(blanks.map(() => ''));

    const handleSubmit = () => {
        let result = scaffold.prompt_template;
        answers.forEach((answer) => {
            result = result.replace('______', answer || '______');
        });
        onSubmit(result);
    };

    const parts = scaffold.prompt_template.split('______');

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-900">
                        {scaffold.display_name}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X className="w-4 h-4 text-gray-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-3">
                    <p className="text-xs text-gray-500 mb-3">
                        请填写下方空白处，生成提示语
                    </p>

                    {parts.map((part, i) => (
                        <div key={i}>
                            <p className="text-sm text-gray-700 mb-1">{part.trim()}</p>
                            {i < blanks.length && (
                                <input
                                    type="text"
                                    value={answers[i]}
                                    onChange={(e) => {
                                        const newAnswers = [...answers];
                                        newAnswers[i] = e.target.value;
                                        setAnswers(newAnswers);
                                    }}
                                    placeholder={`填写第 ${i + 1} 处`}
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                    autoFocus={i === 0}
                                />
                            )}
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 p-4 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        className="px-4 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-hover transition-colors"
                    >
                        生成到输入框
                    </button>
                </div>
            </div>
        </div>
    );
};
