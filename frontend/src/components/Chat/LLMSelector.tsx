/**
 * LLM 模型选择器组件。
 */
import React from 'react';
import { useChatStore } from '../../store/useChatStore';
import { ChevronDown } from 'lucide-react';

export const LLMSelector: React.FC = () => {
    const {
        selectedProvider,
        availableProviders,
        setSelectedProvider,
    } = useChatStore();

    if (availableProviders.length === 0) return null;

    // 只有 1 个 provider 时显示为标签
    if (availableProviders.length === 1) {
        return (
            <span className="inline-flex items-center px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-500">
                {availableProviders[0].display_name}
            </span>
        );
    }

    return (
        <div className="relative inline-block">
            <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 pr-8 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent cursor-pointer transition-colors"
            >
                {availableProviders.map((p) => (
                    <option key={p.name} value={p.name}>
                        {p.display_name} ({p.model})
                    </option>
                ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        </div>
    );
};
