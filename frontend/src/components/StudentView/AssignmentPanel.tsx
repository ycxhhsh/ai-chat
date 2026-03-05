/**
 * 学生作业提交面板。
 * 包含：文本编辑 → 提交 → 历史列表 → 评分详情展开。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Send, FileText, ChevronDown, ChevronUp, Clock, CheckCircle, Star, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { api as apiTyped } from '../../api';
import type { Assignment } from '../../types';

const statusLabels: Record<string, { text: string; color: string }> = {
    submitted: { text: '已提交', color: 'bg-blue-100 text-blue-700' },
    ai_graded: { text: 'AI 已评分', color: 'bg-violet-100 text-violet-700' },
    reviewed: { text: '教师已复核', color: 'bg-emerald-100 text-emerald-700' },
};

export const AssignmentPanel: React.FC = () => {
    const [content, setContent] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const loadAssignments = useCallback(async () => {
        setLoading(true);
        try {
            const list = await apiTyped.assignments.mine();
            setAssignments(list);
        } catch (e) {
            console.error('Load assignments failed:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAssignments();
    }, [loadAssignments]);

    const handleSubmit = async () => {
        if (!content.trim() || submitting) return;
        setSubmitting(true);
        try {
            await apiTyped.assignments.submit(content.trim());
            setContent('');
            await loadAssignments();
        } catch (e) {
            console.error('Submit failed:', e);
            alert('提交失败，请重试');
        } finally {
            setSubmitting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            handleSubmit();
        }
    };

    const toggleExpand = (id: string) => {
        setExpandedId(prev => prev === id ? null : id);
    };

    return (
        <div className="h-full flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-white">
                <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-500" />
                    <h2 className="text-sm font-semibold text-gray-900">作业提交</h2>
                </div>
                <button
                    onClick={loadAssignments}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <RefreshCw className={clsx('w-3 h-3', loading && 'animate-spin')} />
                    刷新
                </button>
            </div>

            {/* 提交区域 */}
            <div className="px-5 py-4 border-b border-gray-100">
                <label className="block text-xs font-medium text-gray-500 mb-2">
                    撰写作业内容
                </label>
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="在此输入你的作业内容... (Ctrl+Enter 提交)"
                    rows={6}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none transition-all"
                />
                <div className="flex items-center justify-between mt-3">
                    <span className="text-[11px] text-gray-300">
                        {content.length} 字
                    </span>
                    <button
                        onClick={handleSubmit}
                        disabled={!content.trim() || submitting}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                        <Send className="w-3.5 h-3.5" />
                        {submitting ? '提交中...' : '提交作业'}
                    </button>
                </div>
            </div>

            {/* 历史列表 */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
                <h3 className="text-xs font-medium text-gray-500 mb-3">
                    提交记录 ({assignments.length})
                </h3>

                {assignments.length === 0 && !loading && (
                    <div className="text-center py-12 text-gray-300 text-sm">
                        暂无提交记录
                    </div>
                )}

                <div className="space-y-2">
                    {assignments.map((a) => {
                        const s = statusLabels[a.status] || { text: a.status, color: 'bg-gray-100 text-gray-600' };
                        const isExpanded = expandedId === a.assignment_id;
                        return (
                            <div key={a.assignment_id} className="border border-gray-200 rounded-lg overflow-hidden">
                                {/* 摘要行 */}
                                <button
                                    onClick={() => toggleExpand(a.assignment_id)}
                                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                                >
                                    <div className="flex items-center gap-3 min-w-0">
                                        <span className={clsx('text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap', s.color)}>
                                            {s.text}
                                        </span>
                                        <span className="text-sm text-gray-700 truncate">
                                            {a.content?.slice(0, 60) || '无内容'}
                                            {a.content && a.content.length > 60 ? '...' : ''}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 ml-3">
                                        <span className="flex items-center gap-1 text-[10px] text-gray-300">
                                            <Clock className="w-3 h-3" />
                                            {new Date(a.created_at).toLocaleString('zh-CN')}
                                        </span>
                                        {isExpanded ? (
                                            <ChevronUp className="w-4 h-4 text-gray-400" />
                                        ) : (
                                            <ChevronDown className="w-4 h-4 text-gray-400" />
                                        )}
                                    </div>
                                </button>

                                {/* 展开详情 */}
                                {isExpanded && (
                                    <div className="px-4 py-3 border-t border-gray-100 bg-gray-50 space-y-3">
                                        {/* 原文 */}
                                        <div>
                                            <h4 className="text-xs font-medium text-gray-500 mb-1">作业内容</h4>
                                            <p className="text-sm text-gray-700 whitespace-pre-wrap bg-white border border-gray-200 rounded-lg p-3">
                                                {a.content}
                                            </p>
                                        </div>

                                        {/* AI 评分 */}
                                        {a.ai_review && (
                                            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
                                                <div className="flex items-center gap-1.5 mb-2">
                                                    <Star className="w-3.5 h-3.5 text-violet-500" />
                                                    <h4 className="text-xs font-semibold text-violet-700">AI 评分</h4>
                                                </div>
                                                {(a.ai_review as Record<string, any>).total_score !== undefined && (
                                                    <p className="text-lg font-bold text-violet-700 mb-1">
                                                        {(a.ai_review as Record<string, any>).total_score} 分
                                                    </p>
                                                )}
                                                {(a.ai_review as Record<string, any>).summary && (
                                                    <p className="text-xs text-violet-600">
                                                        {(a.ai_review as Record<string, any>).summary}
                                                    </p>
                                                )}
                                                {(a.ai_review as Record<string, any>).suggestions?.length > 0 && (
                                                    <ul className="mt-2 space-y-1">
                                                        {((a.ai_review as Record<string, any>).suggestions as string[]).map((s: string, i: number) => (
                                                            <li key={i} className="text-xs text-violet-500 flex items-start gap-1">
                                                                <span className="mt-0.5">•</span>
                                                                {s}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        )}

                                        {/* 教师复核 */}
                                        {a.teacher_review && (
                                            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                                                <div className="flex items-center gap-1.5 mb-2">
                                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                                                    <h4 className="text-xs font-semibold text-emerald-700">教师复核</h4>
                                                </div>
                                                {(a.teacher_review as Record<string, any>).score !== undefined && (
                                                    <p className="text-lg font-bold text-emerald-700 mb-1">
                                                        {(a.teacher_review as Record<string, any>).score} 分
                                                    </p>
                                                )}
                                                {(a.teacher_review as Record<string, any>).comment && (
                                                    <p className="text-xs text-emerald-600">
                                                        {(a.teacher_review as Record<string, any>).comment}
                                                    </p>
                                                )}
                                                {(a.teacher_review as Record<string, any>).reviewed_by && (
                                                    <p className="text-[10px] text-emerald-400 mt-1">
                                                        — {(a.teacher_review as Record<string, any>).reviewed_by}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {!a.ai_review && !a.teacher_review && (
                                            <p className="text-xs text-gray-300 text-center py-2">等待评分中...</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
