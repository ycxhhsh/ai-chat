import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const proseClassName =
    'prose prose-sm prose-blue max-w-none leading-relaxed [&>p]:mb-1.5 [&>p:last-child]:mb-0 [&>ul]:mb-1.5 [&>ol]:mb-1.5 [&_li]:mb-0.5 [&_code]:bg-violet-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs';

export const parseOptions = (text: string): { content: string; options: string[] } => {
    const match = text.match(/\[OPTIONS\]([\s\S]*?)\[\/OPTIONS\]/);
    if (!match) return { content: text, options: [] };
    const content = text.replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/, '').trim();
    const options = match[1]
        .trim()
        .split('\n')
        .map((line) => line.replace(/^\d+\.\s*/, '').trim())
        .filter(Boolean);
    return { content, options };
};

export const parseThinking = (text: string): { thinking: string | null; answer: string } => {
    const match = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
    if (!match) return { thinking: null, answer: text };
    const thinking = match[1].trim();
    const answer = text.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
    return { thinking, answer };
};

interface MarkdownContentProps {
    content: string;
    className?: string;
    onOptionClick?: (option: string) => void;
}

export const MarkdownContent: React.FC<MarkdownContentProps> = ({
    content,
    className = '',
    onOptionClick,
}) => {
    const { content: displayContent, options } = useMemo(() => parseOptions(content || ''), [content]);
    const { thinking, answer } = useMemo(() => parseThinking(displayContent), [displayContent]);
    const [thinkingOpen, setThinkingOpen] = useState(false);

    return (
        <div className={className}>
            {thinking && (
                <div className="mb-2">
                    <button
                        type="button"
                        onClick={() => setThinkingOpen((open) => !open)}
                        className="flex items-center gap-1 text-[11px] text-violet-500 hover:text-violet-700 transition-colors"
                    >
                        {thinkingOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <span>思考过程</span>
                    </button>
                    {thinkingOpen && (
                        <div className="mt-1 px-3 py-2 bg-violet-50/50 border border-violet-100 rounded-lg text-[11px] text-gray-500 leading-relaxed">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{thinking}</ReactMarkdown>
                        </div>
                    )}
                </div>
            )}
            <div className={proseClassName}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
            </div>
            {options.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                    {options.map((option, index) => (
                        <button
                            type="button"
                            key={`${option}-${index}`}
                            onClick={() => onOptionClick?.(option)}
                            disabled={!onOptionClick}
                            className="px-3 py-1.5 text-xs font-medium text-violet-700 bg-violet-50 border border-violet-200 rounded-full hover:bg-violet-100 hover:border-violet-300 transition-all disabled:cursor-default disabled:hover:bg-violet-50 disabled:hover:border-violet-200"
                        >
                            {option}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
