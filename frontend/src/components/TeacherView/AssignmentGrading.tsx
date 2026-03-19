/**
 * 作业批阅 Tab — 提取自 TeacherDashboard
 */
import React, { useState } from 'react';
import { api as apiTyped } from '../../api';
import clsx from 'clsx';
import { RefreshCw, Star, ClipboardCheck, Paperclip, Download } from 'lucide-react';

interface AssignmentGradingProps {
    assignments: Array<Record<string, any>>;
    setAssignments: React.Dispatch<React.SetStateAction<Array<Record<string, any>>>>;
    loadAssignments: () => void;
}

export const AssignmentGrading: React.FC<AssignmentGradingProps> = ({
    assignments, setAssignments, loadAssignments,
}) => {
    const [reviewingAssignment, setReviewingAssignment] = useState<Record<string, any> | null>(null);
    const [reviewScore, setReviewScore] = useState('');
    const [reviewComment, setReviewComment] = useState('');

    const handleAiGrade = async (assignmentId: string) => {
        try {
            const result = await apiTyped.assignments.grade(assignmentId);
            alert('AI 评分完成');
            setAssignments(prev => prev.map(a =>
                a.assignment_id === assignmentId ? { ...a, ...result } : a
            ));
        } catch (_e) { alert('AI 评分失败'); }
    };

    const handleTeacherReview = async () => {
        if (!reviewingAssignment) return;
        try {
            await apiTyped.assignments.review(
                reviewingAssignment.assignment_id,
                reviewScore ? parseInt(reviewScore, 10) : null,
                reviewComment || null,
            );
            setReviewingAssignment(null);
            setReviewScore('');
            setReviewComment('');
            loadAssignments();
        } catch (_e) { alert('复核失败'); }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl font-bold text-gray-900">作业批阅</h1>
                <button onClick={loadAssignments} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                    <RefreshCw className="w-3.5 h-3.5" /> 刷新
                </button>
            </div>
            <div className="space-y-3">
                {assignments.map((a) => (
                    <div key={a.assignment_id} className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">{a.student_name || '未知'}</span>
                                <span className="text-xs text-gray-400">{a.student_email}</span>
                                <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-medium',
                                    a.status === 'reviewed' ? 'bg-green-50 text-green-600' :
                                        a.status === 'ai_graded' ? 'bg-violet-50 text-violet-600' : 'bg-yellow-50 text-yellow-600')}>
                                    {a.status === 'reviewed' ? '已复核' : a.status === 'ai_graded' ? 'AI 已评' : '待批阅'}
                                </span>
                            </div>
                            <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString('zh-CN')}</span>
                        </div>
                        <p className="text-sm text-gray-700 line-clamp-3 mb-3">{a.content || '(无文本内容)'}</p>
                        {a.file_url && (
                            <div className="mb-3 bg-gray-50 rounded-lg p-2.5">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <Paperclip className="w-3 h-3 text-gray-500" />
                                    <span className="text-xs font-medium text-gray-600">附件</span>
                                </div>
                                <div className="space-y-1">
                                    {a.file_url.split(',').filter(Boolean).map((url: string, i: number) => {
                                        const name = url.split('/').pop()?.replace(/^[a-f0-9]+_/, '') || '附件';
                                        return (
                                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                                className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800 hover:underline">
                                                <Download className="w-3 h-3" />{name}
                                            </a>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        {a.ai_review && (
                            <div className="bg-violet-50 rounded-lg p-3 mb-3">
                                <p className="text-xs font-medium text-violet-700 mb-1">AI 评分</p>
                                <div className="flex gap-3 text-xs text-violet-600">
                                    <span>批判性思维: {a.ai_review.scores?.critical_thinking ?? '-'}</span>
                                    <span>论据: {a.ai_review.scores?.evidence ?? '-'}</span>
                                    <span>逻辑: {a.ai_review.scores?.logic ?? '-'}</span>
                                    <span className="font-bold">总分: {a.ai_review.total_score ?? '-'}</span>
                                </div>
                                {a.ai_review.summary && <p className="text-xs text-violet-500 mt-1">{a.ai_review.summary}</p>}
                            </div>
                        )}
                        {a.teacher_review && (
                            <div className="bg-green-50 rounded-lg p-3 mb-3">
                                <p className="text-xs font-medium text-green-700 mb-1">教师复核</p>
                                <p className="text-xs text-green-600">评分: {a.teacher_review.score ?? '-'} | {a.teacher_review.comment || '无评语'}</p>
                            </div>
                        )}
                        <div className="flex gap-2">
                            {a.status === 'submitted' && (
                                <button onClick={() => handleAiGrade(a.assignment_id)} className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-violet-600 rounded-lg hover:bg-violet-700">
                                    <Star className="w-3 h-3" /> AI 评分
                                </button>
                            )}
                            <button onClick={() => { setReviewingAssignment(a); setReviewScore(''); setReviewComment(''); }}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                <ClipboardCheck className="w-3 h-3" /> 教师复核
                            </button>
                        </div>
                    </div>
                ))}
                {assignments.length === 0 && <div className="text-center py-8 text-gray-300 text-sm">暂无作业</div>}
            </div>
            {reviewingAssignment && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-gray-900">教师复核</h3>
                            <button onClick={() => setReviewingAssignment(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">评分 (0-30)</label>
                                <input type="number" value={reviewScore} onChange={(e) => setReviewScore(e.target.value)}
                                    min="0" max="30" className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-700 mb-1">评语</label>
                                <textarea value={reviewComment} onChange={(e) => setReviewComment(e.target.value)}
                                    rows={3} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                            </div>
                            <div className="flex justify-end gap-2 pt-2">
                                <button onClick={() => setReviewingAssignment(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
                                <button onClick={handleTeacherReview} className="px-4 py-2 text-sm text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors">提交</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
