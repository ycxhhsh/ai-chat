/**
 * DeepSearch 深度调研弹窗。
 * 输入调研主题 → 进度条 → 报告展示。
 */
import React, { useState, useCallback } from 'react';
import { X, Search, Loader2, FileText } from 'lucide-react';
import { api } from '../../api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
    open: boolean;
    onClose: () => void;
    sessionId?: string;
}

interface JobState {
    jobId: string | null;
    status: 'idle' | 'running' | 'done' | 'failed';
    progress: number;
    statusText: string;
    report: string | null;
    sources: { title: string; url: string; content: string }[];
}

export const DeepSearchDialog: React.FC<Props> = ({ open, onClose, sessionId }) => {
    const [topic, setTopic] = useState('');
    const [job, setJob] = useState<JobState>({
        jobId: null, status: 'idle', progress: 0, statusText: '', report: null, sources: [],
    });

    const handleStart = useCallback(async () => {
        if (!topic.trim()) return;

        try {
            const result = await api.jobs.create({
                type: 'deep_search',
                title: topic,
                input_data: { topic },
                session_id: sessionId,
            });

            setJob({
                jobId: result.id,
                status: 'running',
                progress: 0,
                statusText: '任务已创建...',
                report: null,
                sources: [],
            });

            // 轮询进度
            const pollInterval = setInterval(async () => {
                try {
                    const j = await api.jobs.get(result.id);
                    setJob(prev => ({
                        ...prev,
                        progress: j.progress,
                        status: j.status === 'done' ? 'done' : j.status === 'failed' ? 'failed' : 'running',
                        statusText: j.status === 'done' ? '完成' : j.status === 'failed' ? '失败' : `进度 ${j.progress}%`,
                        report: j.result?.report || null,
                        sources: j.result?.sources || [],
                    }));

                    if (j.status === 'done' || j.status === 'failed') {
                        clearInterval(pollInterval);
                    }
                } catch {
                    // Ignore polling errors
                }
            }, 2000);

        } catch (e) {
            console.error('Create DeepSearch job failed:', e);
            setJob(prev => ({ ...prev, status: 'failed', statusText: '创建失败' }));
        }
    }, [topic, sessionId]);

    const handleReset = () => {
        setJob({
            jobId: null, status: 'idle', progress: 0, statusText: '', report: null, sources: [],
        });
        setTopic('');
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-[calc(100vw-32px)] max-w-[600px] max-h-[80vh] flex flex-col overflow-hidden border border-gray-200">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-white">
                    <div className="flex items-center gap-2">
                        <Search className="w-4 h-4 text-emerald-500" />
                        <h2 className="text-sm font-semibold text-gray-900">🔍 深度调研（DeepSearch）</h2>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                    {/* 输入 */}
                    {job.status === 'idle' && (
                        <div className="space-y-3">
                            <p className="text-xs text-gray-500">
                                输入研究主题，AI 将自动拆解子问题、联网搜索、综合分析并生成调研报告。
                            </p>
                            <textarea
                                value={topic}
                                onChange={e => setTopic(e.target.value)}
                                placeholder="例如：2024年大语言模型在教育领域的应用现状与趋势"
                                rows={3}
                                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
                            />
                            <button
                                onClick={handleStart}
                                disabled={!topic.trim()}
                                className="w-full py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
                            >
                                <Search className="w-4 h-4" />
                                开始调研
                            </button>
                        </div>
                    )}

                    {/* 进度 */}
                    {job.status === 'running' && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                                <span className="text-sm text-gray-700">{job.statusText}</span>
                            </div>
                            <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                    style={{ width: `${job.progress}%` }}
                                />
                            </div>
                            <p className="text-[10px] text-gray-400 text-center">
                                调研可能需要 30-60 秒，请耐心等待
                            </p>
                        </div>
                    )}

                    {/* 失败 */}
                    {job.status === 'failed' && (
                        <div className="text-center space-y-3 py-8">
                            <p className="text-sm text-red-500">调研失败，请稍后重试</p>
                            <button
                                onClick={handleReset}
                                className="px-4 py-2 text-sm text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50"
                            >
                                重新开始
                            </button>
                        </div>
                    )}

                    {/* 报告 */}
                    {job.status === 'done' && job.report && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 mb-2">
                                <FileText className="w-4 h-4 text-emerald-500" />
                                <h3 className="text-sm font-medium text-gray-900">调研报告</h3>
                            </div>
                            <div className="prose prose-sm prose-emerald max-w-none bg-gray-50 border border-gray-200 rounded-lg p-4 leading-relaxed [&>h1]:text-base [&>h2]:text-sm [&>h3]:text-xs">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {job.report}
                                </ReactMarkdown>
                            </div>

                            {/* 搜索来源 */}
                            {job.sources.length > 0 && (
                                <div>
                                    <p className="text-[10px] text-emerald-500 font-medium mb-1">🌐 来源 ({job.sources.length})</p>
                                    <div className="flex flex-wrap gap-1">
                                        {job.sources.slice(0, 10).map((s, i) => (
                                            <a
                                                key={i}
                                                href={s.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors max-w-[200px] truncate"
                                            >
                                                [{i + 1}] <span className="truncate">{s.title}</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={handleReset}
                                className="w-full py-2 text-sm text-emerald-600 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-all"
                            >
                                发起新调研
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
