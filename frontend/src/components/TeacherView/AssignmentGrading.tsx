import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    CheckCircle,
    ClipboardCheck,
    FileText,
    Paperclip,
    Plus,
    RefreshCw,
    Send,
    Users,
} from 'lucide-react';
import clsx from 'clsx';
import { api as apiTyped } from '../../api';
import type { AssignmentTask, TeacherAssignmentTaskDetail, TeacherAssignmentTaskTarget } from '../../types';

interface AssignmentGradingProps {
    assignments?: Array<Record<string, any>>;
    setAssignments?: React.Dispatch<React.SetStateAction<Array<Record<string, any>>>>;
    loadAssignments?: () => void;
}

interface ReviewDraft {
    score: string;
    comment: string;
    saving?: boolean;
}

const statusLabels: Record<string, { text: string; color: string }> = {
    published: { text: '提交中', color: 'bg-blue-50 text-blue-700 border-blue-100' },
    peer_review: { text: '互评中', color: 'bg-amber-50 text-amber-700 border-amber-100' },
    closed: { text: '已结束', color: 'bg-gray-50 text-gray-600 border-gray-200' },
};

const validScore = (value: string) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
};

export const AssignmentGrading: React.FC<AssignmentGradingProps> = () => {
    const [tasks, setTasks] = useState<AssignmentTask[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [detail, setDetail] = useState<TeacherAssignmentTaskDetail | null>(null);
    const [students, setStudents] = useState<Array<Record<string, any>>>([]);
    const [loading, setLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [startingPeerReview, setStartingPeerReview] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [peerReviewCount, setPeerReviewCount] = useState('5');
    const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
    const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});

    const selectedTask = useMemo(
        () => tasks.find(task => task.task_id === selectedTaskId) || null,
        [selectedTaskId, tasks],
    );

    const loadTasks = useCallback(async () => {
        setLoading(true);
        try {
            const data = await apiTyped.teacher.assignmentTasks();
            setTasks(data);
            setSelectedTaskId(prev => prev || data[0]?.task_id || null);
        } catch (e) {
            console.error('Load assignment tasks failed:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadStudents = useCallback(async () => {
        try {
            const data = await apiTyped.teacher.students(1, 100);
            setStudents(data.students || []);
        } catch (e) {
            console.error('Load students failed:', e);
        }
    }, []);

    const loadDetail = useCallback(async (taskId: string) => {
        setDetailLoading(true);
        try {
            const data = await apiTyped.teacher.assignmentTaskDetail(taskId);
            setDetail(data);
            const drafts: Record<string, ReviewDraft> = {};
            data.targets.forEach(target => {
                if (target.assignment) {
                    drafts[target.assignment.assignment_id] = {
                        score: target.assignment.teacher_review?.score != null
                            ? String((target.assignment.teacher_review as any).score)
                            : '',
                        comment: ((target.assignment.teacher_review as any)?.comment as string) || '',
                    };
                }
            });
            setReviewDrafts(drafts);
        } catch (e) {
            console.error('Load assignment task detail failed:', e);
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTasks();
        loadStudents();
    }, [loadTasks, loadStudents]);

    useEffect(() => {
        if (selectedTaskId) {
            loadDetail(selectedTaskId);
        } else {
            setDetail(null);
        }
    }, [loadDetail, selectedTaskId]);

    const toggleStudent = (studentId: string) => {
        setSelectedStudentIds(prev => {
            const next = new Set(prev);
            if (next.has(studentId)) next.delete(studentId);
            else next.add(studentId);
            return next;
        });
    };

    const selectAllStudents = () => {
        setSelectedStudentIds(new Set(students.map(student => String(student.user_id))));
    };

    const clearStudents = () => {
        setSelectedStudentIds(new Set());
    };

    const handleCreateTask = async () => {
        const count = Number(peerReviewCount);
        if (!title.trim()) {
            alert('请输入作业标题');
            return;
        }
        if (!Number.isInteger(count) || count < 1 || count > 10) {
            alert('互评份数必须是 1-10 的整数');
            return;
        }
        if (selectedStudentIds.size === 0) {
            alert('请至少选择一名学生');
            return;
        }
        setCreating(true);
        try {
            const task = await apiTyped.teacher.createAssignmentTask({
                title: title.trim(),
                description: description.trim() || null,
                target_student_ids: Array.from(selectedStudentIds),
                peer_review_count: count,
            });
            setTitle('');
            setDescription('');
            setPeerReviewCount('5');
            setSelectedStudentIds(new Set());
            setShowCreate(false);
            await loadTasks();
            setSelectedTaskId(task.task_id);
        } catch (e) {
            console.error('Create assignment task failed:', e);
            alert('发布作业任务失败，请检查学生名单');
        } finally {
            setCreating(false);
        }
    };

    const handleStartPeerReview = async () => {
        if (!selectedTaskId) return;
        if (!window.confirm('开启互评后学生将不能再提交或修改作业，确认开启？')) return;
        setStartingPeerReview(true);
        try {
            await apiTyped.teacher.startAssignmentPeerReview(selectedTaskId);
            await Promise.all([loadTasks(), loadDetail(selectedTaskId)]);
        } catch (e: any) {
            console.error('Start peer review failed:', e);
            alert(e?.response?.data?.detail || '开启互评失败，可能是提交人数不足');
        } finally {
            setStartingPeerReview(false);
        }
    };

    const handleTeacherReview = async (target: TeacherAssignmentTaskTarget) => {
        if (!target.assignment || !selectedTaskId) return;
        const draft = reviewDrafts[target.assignment.assignment_id];
        if (!draft || !validScore(draft.score)) {
            alert('教师评分必须是 0-100 的整数');
            return;
        }
        setReviewDrafts(prev => ({
            ...prev,
            [target.assignment!.assignment_id]: { ...draft, saving: true },
        }));
        try {
            await apiTyped.assignments.review(
                target.assignment.assignment_id,
                Number(draft.score),
                draft.comment.trim() || null,
            );
            await Promise.all([loadTasks(), loadDetail(selectedTaskId)]);
        } catch (e) {
            console.error('Teacher review failed:', e);
            alert('教师评分保存失败');
        }
    };

    const renderBadge = (status: string) => {
        const info = statusLabels[status] || { text: status, color: 'bg-gray-50 text-gray-600 border-gray-200' };
        return <span className={clsx('text-[11px] px-2 py-0.5 rounded-full border font-medium', info.color)}>{info.text}</span>;
    };

    const renderAttachments = (fileUrl: string | null | undefined) => {
        const urls = (fileUrl || '').split(',').filter(Boolean);
        if (urls.length === 0) return null;
        return (
            <div className="space-y-1 mt-2">
                {urls.map(url => {
                    const name = url.split('/').pop()?.replace(/^[a-f0-9]+_/, '') || '附件';
                    return (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800">
                            <Paperclip className="w-3 h-3" />
                            <span className="truncate">{name}</span>
                        </a>
                    );
                })}
            </div>
        );
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-bold text-gray-900">作业任务与互评</h1>
                    <p className="text-sm text-gray-500 mt-1">发布单次作业、开启匿名互评，并查看自评/互评/教师评分情况。</p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={loadTasks} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                        <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
                        刷新
                    </button>
                    <button onClick={() => setShowCreate(prev => !prev)} className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-black">
                        <Plus className="w-4 h-4" />
                        发布作业
                    </button>
                </div>
            </div>

            {showCreate && (
                <section className="bg-white border border-gray-200 rounded-lg p-4">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr,280px] gap-4">
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">作业标题</label>
                                <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">作业说明</label>
                                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                            </div>
                            <div className="w-36">
                                <label className="block text-xs font-medium text-gray-500 mb-1">每人互评份数</label>
                                <input type="number" min="1" max="10" value={peerReviewCount} onChange={(event) => setPeerReviewCount(event.target.value)} className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                            </div>
                        </div>
                        <div className="border border-gray-200 rounded-lg overflow-hidden">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                                <span className="text-sm font-medium text-gray-700">发布对象 ({selectedStudentIds.size})</span>
                                <div className="flex gap-2 text-xs">
                                    <button onClick={selectAllStudents} className="text-indigo-600 hover:text-indigo-800">全选</button>
                                    <button onClick={clearStudents} className="text-gray-500 hover:text-gray-700">清空</button>
                                </div>
                            </div>
                            <div className="max-h-72 overflow-y-auto p-2 space-y-1">
                                {students.map(student => {
                                    const id = String(student.user_id);
                                    return (
                                        <label key={id} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer">
                                            <input type="checkbox" checked={selectedStudentIds.has(id)} onChange={() => toggleStudent(id)} className="rounded border-gray-300" />
                                            <span className="min-w-0">
                                                <span className="block text-sm text-gray-800 truncate">{String(student.name || '未命名')}</span>
                                                <span className="block text-[11px] text-gray-400 truncate">{String(student.email || '')}</span>
                                            </span>
                                        </label>
                                    );
                                })}
                                {students.length === 0 && <p className="text-sm text-gray-400 text-center py-6">暂无学生</p>}
                            </div>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 mt-4">
                        <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">取消</button>
                        <button onClick={handleCreateTask} disabled={creating} className="px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                            {creating ? '发布中...' : '确认发布'}
                        </button>
                    </div>
                </section>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[320px,1fr] gap-5">
                <aside className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                        <FileText className="w-4 h-4 text-indigo-500" />
                        <span className="text-sm font-semibold text-gray-900">作业任务</span>
                    </div>
                    <div className="p-3 space-y-2 max-h-[720px] overflow-y-auto">
                        {tasks.map(task => (
                            <button
                                key={task.task_id}
                                onClick={() => setSelectedTaskId(task.task_id)}
                                className={clsx(
                                    'w-full text-left border rounded-lg p-3 transition-colors',
                                    selectedTaskId === task.task_id ? 'border-indigo-200 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50',
                                )}
                            >
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <span className="text-sm font-medium text-gray-900 truncate">{task.title}</span>
                                    {renderBadge(task.status)}
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-500">
                                    <span>对象 {task.target_count ?? 0}</span>
                                    <span>提交 {task.submitted_count ?? 0}</span>
                                    <span>互评 {task.peer_review_completed ?? 0}/{task.peer_review_total ?? 0}</span>
                                </div>
                            </button>
                        ))}
                        {tasks.length === 0 && !loading && <p className="text-sm text-gray-400 text-center py-8">暂无作业任务</p>}
                    </div>
                </aside>

                <main className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                    {!selectedTask && !detailLoading && (
                        <div className="p-10 text-center text-sm text-gray-400">请选择一个作业任务</div>
                    )}
                    {detailLoading && (
                        <div className="p-10 text-center text-sm text-gray-400">加载中...</div>
                    )}
                    {detail && selectedTask && (
                        <div>
                            <div className="px-5 py-4 border-b border-gray-100">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <h2 className="text-lg font-semibold text-gray-900">{detail.task.title}</h2>
                                            {renderBadge(detail.task.status)}
                                        </div>
                                        {detail.task.description && <p className="text-sm text-gray-600 whitespace-pre-wrap">{detail.task.description}</p>}
                                    </div>
                                    {detail.task.status === 'published' && (
                                        <button onClick={handleStartPeerReview} disabled={startingPeerReview} className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                                            <Send className="w-4 h-4" />
                                            {startingPeerReview ? '生成中...' : '开启互评'}
                                        </button>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-4">
                                    {[
                                        ['发布对象', detail.task.target_count ?? 0],
                                        ['已提交', detail.task.submitted_count ?? 0],
                                        ['缺交', detail.task.missing_count ?? 0],
                                        ['自评', detail.task.self_review_count ?? 0],
                                        ['互评', `${detail.task.peer_review_completed ?? 0}/${detail.task.peer_review_total ?? 0}`],
                                        ['教师评分', detail.task.teacher_reviewed_count ?? 0],
                                    ].map(([label, value]) => (
                                        <div key={label} className="bg-gray-50 rounded-lg px-3 py-2">
                                            <p className="text-[11px] text-gray-400">{label}</p>
                                            <p className="text-sm font-semibold text-gray-900">{value}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="p-4 space-y-3">
                                {detail.targets.map(target => {
                                    const assignment = target.assignment;
                                    const draft = assignment ? reviewDrafts[assignment.assignment_id] || { score: '', comment: '' } : null;
                                    const completedAssigned = target.peer_reviews_assigned.filter(review => review.status === 'submitted').length;
                                    return (
                                        <section key={target.student_id} className="border border-gray-200 rounded-lg p-4">
                                            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-sm font-medium shrink-0">
                                                        {target.student_name?.charAt(0) || '?'}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-gray-900 truncate">{target.student_name}</p>
                                                        <p className="text-xs text-gray-400 truncate">{target.student_email}</p>
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2 text-[11px]">
                                                    <span className={clsx('px-2 py-0.5 rounded-full', assignment ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600')}>
                                                        {assignment ? '已提交' : '缺交'}
                                                    </span>
                                                    <span className={clsx('px-2 py-0.5 rounded-full', target.self_review ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500')}>
                                                        自评 {target.self_review ? `${target.self_review.score} 分` : '未完成'}
                                                    </span>
                                                    <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500">
                                                        互评 {completedAssigned}/{target.peer_reviews_assigned.length}
                                                    </span>
                                                </div>
                                            </div>

                                            {assignment ? (
                                                <div className="grid grid-cols-1 2xl:grid-cols-[1fr,360px] gap-4">
                                                    <div>
                                                        <p className="text-xs font-medium text-gray-500 mb-1">作业内容</p>
                                                        <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3">{assignment.content || '(仅附件提交)'}</p>
                                                        {renderAttachments(assignment.file_url)}
                                                        {target.self_review && (
                                                            <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg p-3">
                                                                <p className="text-xs font-medium text-blue-700 mb-1">学生自评：{target.self_review.score} 分</p>
                                                                <p className="text-sm text-blue-700 whitespace-pre-wrap">{target.self_review.comment || '无评语'}</p>
                                                            </div>
                                                        )}
                                                        {target.peer_reviews_received.length > 0 && (
                                                            <div className="mt-3">
                                                                <p className="text-xs font-medium text-gray-500 mb-2">收到的互评</p>
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                    {target.peer_reviews_received.map(review => (
                                                                        <div key={review.id} className="bg-amber-50 border border-amber-100 rounded-lg p-2">
                                                                            <div className="flex items-center justify-between text-xs mb-1">
                                                                                <span className="font-medium text-amber-700">{review.reviewer_name || '未提交'}</span>
                                                                                <span className="text-amber-700">{review.score ?? '-'} 分</span>
                                                                            </div>
                                                                            <p className="text-xs text-amber-700 whitespace-pre-wrap">{review.comment || '无评语'}</p>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="border border-gray-200 rounded-lg p-3">
                                                        <div className="flex items-center gap-1.5 mb-3">
                                                            <ClipboardCheck className="w-4 h-4 text-emerald-500" />
                                                            <p className="text-sm font-semibold text-gray-900">教师最终评分</p>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max="100"
                                                                value={draft?.score || ''}
                                                                onChange={(event) => setReviewDrafts(prev => ({
                                                                    ...prev,
                                                                    [assignment.assignment_id]: { ...(draft || { comment: '' }), score: event.target.value },
                                                                }))}
                                                                placeholder="0-100"
                                                                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                                            />
                                                            <textarea
                                                                value={draft?.comment || ''}
                                                                onChange={(event) => setReviewDrafts(prev => ({
                                                                    ...prev,
                                                                    [assignment.assignment_id]: { ...(draft || { score: '' }), comment: event.target.value },
                                                                }))}
                                                                rows={4}
                                                                placeholder="教师评语"
                                                                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                                                            />
                                                            <button onClick={() => handleTeacherReview(target)} disabled={draft?.saving} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                                                                <CheckCircle className="w-4 h-4" />
                                                                {draft?.saving ? '保存中...' : '保存评分'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg p-3">
                                                    <Users className="w-4 h-4" />
                                                    该学生未提交作业；若已开启互评，仍需完成被分配的互评任务。
                                                </div>
                                            )}
                                        </section>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};
