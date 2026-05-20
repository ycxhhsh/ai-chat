import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CheckCircle,
    ClipboardCheck,
    Clock,
    FileText,
    Paperclip,
    RefreshCw,
    Send,
    Upload,
    X,
} from 'lucide-react';
import clsx from 'clsx';
import { api as apiTyped } from '../../api';
import type { Assignment, AssignmentTaskDetail, AssignmentTaskListItem, StudentPeerReview } from '../../types';

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif'];
const MAX_FILES = 3;
const MAX_SIZE = 20 * 1024 * 1024;
const LEGACY_TASK_ID = '__legacy_uploaded_assignments__';

interface UploadedFile {
    file: File;
    progress: number;
    url?: string;
    error?: string;
}

interface ReviewDraft {
    score: string;
    comment: string;
    saving?: boolean;
}

const taskStatusLabels: Record<string, { text: string; color: string }> = {
    published: { text: '提交中', color: 'bg-blue-50 text-blue-700 border-blue-100' },
    peer_review: { text: '互评中', color: 'bg-amber-50 text-amber-700 border-amber-100' },
    closed: { text: '已结束', color: 'bg-gray-50 text-gray-600 border-gray-200' },
    legacy: { text: '历史记录', color: 'bg-slate-50 text-slate-600 border-slate-200' },
};

const scoreValid = (value: string) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100;
};

export const AssignmentPanel: React.FC = () => {
    const [tasks, setTasks] = useState<AssignmentTaskListItem[]>([]);
    const [legacyAssignments, setLegacyAssignments] = useState<Assignment[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [detail, setDetail] = useState<AssignmentTaskDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [content, setContent] = useState('');
    const [files, setFiles] = useState<UploadedFile[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [selfScore, setSelfScore] = useState('');
    const [selfComment, setSelfComment] = useState('');
    const [selfSaving, setSelfSaving] = useState(false);
    const [peerDrafts, setPeerDrafts] = useState<Record<string, ReviewDraft>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    const displayTasks = useMemo(() => {
        if (legacyAssignments.length === 0) return tasks;
        const legacyTask: AssignmentTaskListItem = {
            task: {
                task_id: LEGACY_TASK_ID,
                title: '已上传过的作业',
                description: '这里汇总之前上传、但未归属于作业任务的历史作业。',
                status: 'legacy',
                peer_review_count: 0,
                peer_review_started_at: null,
                created_at: legacyAssignments[0]?.created_at || new Date().toISOString(),
                updated_at: legacyAssignments[0]?.created_at || new Date().toISOString(),
            },
            assignment: null,
            self_review: null,
            peer_review_total: legacyAssignments.length,
            peer_review_completed: legacyAssignments.length,
        };
        return [legacyTask, ...tasks];
    }, [legacyAssignments, tasks]);

    const selectedTask = useMemo(
        () => displayTasks.find(item => item.task.task_id === selectedTaskId) || null,
        [displayTasks, selectedTaskId],
    );

    const isLegacySelected = selectedTaskId === LEGACY_TASK_ID;

    const loadTasks = useCallback(async () => {
        setLoading(true);
        try {
            const [data, mine] = await Promise.all([
                apiTyped.assignments.tasks(),
                apiTyped.assignments.mine(),
            ]);
            const legacy = mine.filter(item => !item.task_id);
            setTasks(data);
            setLegacyAssignments(legacy);
            setSelectedTaskId(prev => {
                const validIds = new Set([
                    ...(legacy.length > 0 ? [LEGACY_TASK_ID] : []),
                    ...data.map(item => item.task.task_id),
                ]);
                if (prev && validIds.has(prev)) return prev;
                return legacy.length > 0 ? LEGACY_TASK_ID : data[0]?.task.task_id || null;
            });
        } catch (e) {
            console.error('Load assignment tasks failed:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadDetail = useCallback(async (taskId: string) => {
        setDetailLoading(true);
        try {
            const data = await apiTyped.assignments.taskDetail(taskId);
            setDetail(data);
            setContent(data.assignment?.content || '');
            setSelfScore(data.self_review?.score != null ? String(data.self_review.score) : '');
            setSelfComment(data.self_review?.comment || '');
            const drafts: Record<string, ReviewDraft> = {};
            data.peer_reviews.forEach(review => {
                drafts[review.id] = {
                    score: review.score != null ? String(review.score) : '',
                    comment: review.comment || '',
                };
            });
            setPeerDrafts(drafts);
            setFiles([]);
        } catch (e) {
            console.error('Load assignment task detail failed:', e);
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    }, []);

    useEffect(() => {
        loadTasks();
    }, [loadTasks]);

    useEffect(() => {
        if (selectedTaskId === LEGACY_TASK_ID) {
            setDetail(null);
            setContent('');
            setSelfScore('');
            setSelfComment('');
            setPeerDrafts({});
            setFiles([]);
            setDetailLoading(false);
        } else if (selectedTaskId) {
            loadDetail(selectedTaskId);
        } else {
            setDetail(null);
        }
    }, [loadDetail, selectedTaskId]);

    const validateFile = (file: File): string | null => {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return `不支持 ${ext} 格式`;
        }
        if (file.size > MAX_SIZE) {
            return `文件超过 20MB`;
        }
        return null;
    };

    const addFiles = (newFiles: FileList | File[]) => {
        const remaining = MAX_FILES - files.length;
        if (remaining <= 0) {
            alert(`最多添加 ${MAX_FILES} 个附件`);
            return;
        }
        const validated = Array.from(newFiles).slice(0, remaining).map(file => {
            const error = validateFile(file);
            return { file, progress: 0, error: error || undefined };
        });
        setFiles(prev => [...prev, ...validated]);
    };

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const uploadFiles = async () => {
        const uploadedUrls: string[] = [];
        for (let i = 0; i < files.length; i += 1) {
            const item = files[i];
            setFiles(prev => prev.map((file, idx) => idx === i ? { ...file, progress: 30 } : file));
            const result = await apiTyped.upload.file(item.file);
            uploadedUrls.push(result.file_url);
            setFiles(prev => prev.map((file, idx) => idx === i ? { ...file, progress: 100, url: result.file_url } : file));
        }
        if (uploadedUrls.length > 0) return uploadedUrls.join(',');
        return detail?.assignment?.file_url || null;
    };

    const handleSubmit = async () => {
        if (!selectedTaskId || submitting) return;
        if ((!content.trim() && files.length === 0 && !detail?.assignment?.file_url) || files.some(file => file.error)) return;
        setSubmitting(true);
        try {
            const fileUrl = await uploadFiles();
            await apiTyped.assignments.submitToTask(selectedTaskId, content.trim() || '(附件提交)', fileUrl);
            await Promise.all([loadTasks(), loadDetail(selectedTaskId)]);
        } catch (e) {
            console.error('Submit assignment failed:', e);
            alert('提交失败，请稍后重试');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSelfReview = async () => {
        if (!selectedTaskId || !scoreValid(selfScore)) {
            alert('自评分数必须是 0-100 的整数');
            return;
        }
        setSelfSaving(true);
        try {
            await apiTyped.assignments.submitSelfReview(selectedTaskId, Number(selfScore), selfComment.trim() || null);
            await Promise.all([loadTasks(), loadDetail(selectedTaskId)]);
        } catch (e) {
            console.error('Submit self review failed:', e);
            alert('自评提交失败');
        } finally {
            setSelfSaving(false);
        }
    };

    const handlePeerReview = async (review: StudentPeerReview) => {
        const draft = peerDrafts[review.id];
        if (!draft || !scoreValid(draft.score)) {
            alert('互评分数必须是 0-100 的整数');
            return;
        }
        setPeerDrafts(prev => ({
            ...prev,
            [review.id]: { ...draft, saving: true },
        }));
        try {
            await apiTyped.assignments.submitPeerReview(review.id, Number(draft.score), draft.comment.trim() || null);
            if (selectedTaskId) {
                await Promise.all([loadTasks(), loadDetail(selectedTaskId)]);
            }
        } catch (e) {
            console.error('Submit peer review failed:', e);
            alert('互评提交失败');
        }
    };

    const renderAttachments = (fileUrl: string | null | undefined) => {
        const urls = (fileUrl || '').split(',').filter(Boolean);
        if (urls.length === 0) return null;
        return (
            <div className="space-y-1">
                {urls.map((url, index) => {
                    const name = url.split('/').pop()?.replace(/^[a-f0-9]+_/, '') || `附件 ${index + 1}`;
                    return (
                        <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-800"
                        >
                            <Paperclip className="w-3 h-3" />
                            <span className="truncate">{name}</span>
                        </a>
                    );
                })}
            </div>
        );
    };

    const renderTaskBadge = (status: string) => {
        const info = taskStatusLabels[status] || { text: status, color: 'bg-gray-50 text-gray-600 border-gray-200' };
        return <span className={clsx('text-[11px] px-2 py-0.5 rounded-full border font-medium', info.color)}>{info.text}</span>;
    };

    const canSubmit = !isLegacySelected && detail?.task.status === 'published';
    const peerCompleted = selectedTask?.peer_review_completed ?? 0;
    const peerTotal = selectedTask?.peer_review_total ?? 0;

    return (
        <div className="h-full bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-indigo-500" />
                    <h2 className="text-sm font-semibold text-gray-900">作业任务</h2>
                </div>
                <button onClick={loadTasks} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700">
                    <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
                    刷新
                </button>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[280px,1fr]">
                <aside className="border-b lg:border-b-0 lg:border-r border-gray-100 overflow-y-auto">
                    {displayTasks.length === 0 && !loading && (
                        <div className="px-5 py-10 text-sm text-gray-400 text-center">暂无发布给你的作业任务</div>
                    )}
                    <div className="p-3 space-y-2">
                        {displayTasks.map(item => (
                            <button
                                key={item.task.task_id}
                                onClick={() => setSelectedTaskId(item.task.task_id)}
                                className={clsx(
                                    'w-full text-left rounded-lg border p-3 transition-colors',
                                    selectedTaskId === item.task.task_id
                                        ? 'border-indigo-200 bg-indigo-50'
                                        : 'border-gray-200 hover:bg-gray-50',
                                )}
                            >
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <span className="text-sm font-medium text-gray-900 truncate">{item.task.title}</span>
                                    {renderTaskBadge(item.task.status)}
                                </div>
                                <div className="flex items-center justify-between text-[11px] text-gray-400">
                                    {item.task.task_id === LEGACY_TASK_ID ? (
                                        <>
                                            <span>{legacyAssignments.length} 条历史提交</span>
                                            <span>原样留存</span>
                                        </>
                                    ) : (
                                        <>
                                            <span>{item.assignment ? '已提交' : '未提交'}</span>
                                            <span>互评 {item.peer_review_completed}/{item.peer_review_total}</span>
                                        </>
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                <main className="min-h-0 overflow-y-auto">
                    {!detail && !detailLoading && !isLegacySelected && (
                        <div className="h-full flex items-center justify-center text-sm text-gray-400">请选择一个作业任务</div>
                    )}
                    {detailLoading && (
                        <div className="h-full flex items-center justify-center text-sm text-gray-400">加载中...</div>
                    )}
                    {isLegacySelected && (
                        <div className="p-5 space-y-4">
                            <section className="border border-gray-200 rounded-lg p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-lg font-semibold text-gray-900">已上传过的作业</h3>
                                            {renderTaskBadge('legacy')}
                                        </div>
                                        <p className="text-sm text-gray-600">
                                            这些是之前已经上传、但没有归属到新作业任务中的历史提交。它们不会参与新任务的自评或互评分配。
                                        </p>
                                    </div>
                                    <div className="text-xs text-gray-400">{legacyAssignments.length} 条记录</div>
                                </div>
                            </section>

                            {legacyAssignments.length === 0 ? (
                                <div className="text-center py-12 text-sm text-gray-400">暂无历史作业。</div>
                            ) : (
                                <div className="space-y-3">
                                    {legacyAssignments.map((assignment, index) => (
                                        <section key={assignment.assignment_id} className="border border-gray-200 rounded-lg p-4">
                                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-semibold text-gray-900">历史作业 {index + 1}</span>
                                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-600 border border-gray-200">
                                                        {assignment.status}
                                                    </span>
                                                </div>
                                                <div className="text-xs text-gray-400 flex items-center gap-1">
                                                    <Clock className="w-3.5 h-3.5" />
                                                    {new Date(assignment.created_at).toLocaleString('zh-CN')}
                                                </div>
                                            </div>
                                            <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3">
                                                {assignment.content || '(仅附件提交)'}
                                            </p>
                                            <div className="mt-2">{renderAttachments(assignment.file_url)}</div>

                                            {(assignment.ai_review || assignment.teacher_review) && (
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                                                    {assignment.ai_review && (
                                                        <div className="bg-violet-50 border border-violet-100 rounded-lg p-3">
                                                            <p className="text-xs font-medium text-violet-700 mb-1">AI 评分</p>
                                                            <p className="text-sm text-violet-700">
                                                                总分：{(assignment.ai_review as any).total_score ?? '-'}
                                                            </p>
                                                            <p className="text-xs text-violet-600 mt-1 whitespace-pre-wrap">
                                                                {(assignment.ai_review as any).brief_comment || (assignment.ai_review as any).summary || '无评语'}
                                                            </p>
                                                        </div>
                                                    )}
                                                    {assignment.teacher_review && (
                                                        <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                                                            <p className="text-xs font-medium text-emerald-700 mb-1">教师评分</p>
                                                            <p className="text-sm text-emerald-700">
                                                                分数：{(assignment.teacher_review as any).score ?? '-'}
                                                            </p>
                                                            <p className="text-xs text-emerald-600 mt-1 whitespace-pre-wrap">
                                                                {(assignment.teacher_review as any).comment || '无评语'}
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </section>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {detail && (
                        <div className="p-5 space-y-5">
                            <section className="border border-gray-200 rounded-lg p-4">
                                <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
                                    <div>
                                        <div className="flex items-center gap-2 mb-1">
                                            <h3 className="text-lg font-semibold text-gray-900">{detail.task.title}</h3>
                                            {renderTaskBadge(detail.task.status)}
                                        </div>
                                        {detail.task.description && (
                                            <p className="text-sm text-gray-600 whitespace-pre-wrap">{detail.task.description}</p>
                                        )}
                                    </div>
                                    <div className="text-xs text-gray-400 flex items-center gap-1">
                                        <Clock className="w-3.5 h-3.5" />
                                        {new Date(detail.task.created_at).toLocaleString('zh-CN')}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                                        <p className="text-gray-400">提交状态</p>
                                        <p className="font-medium text-gray-900">{detail.assignment ? '已提交' : '未提交'}</p>
                                    </div>
                                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                                        <p className="text-gray-400">自评</p>
                                        <p className="font-medium text-gray-900">{detail.self_review ? `${detail.self_review.score} 分` : '未完成'}</p>
                                    </div>
                                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                                        <p className="text-gray-400">互评进度</p>
                                        <p className="font-medium text-gray-900">{peerCompleted}/{peerTotal}</p>
                                    </div>
                                    <div className="bg-gray-50 rounded-lg px-3 py-2">
                                        <p className="text-gray-400">教师评分</p>
                                        <p className="font-medium text-gray-900">{(detail.assignment?.teacher_review as any)?.score ?? '待评分'}</p>
                                    </div>
                                </div>
                            </section>

                            <section className="border border-gray-200 rounded-lg p-4">
                                <div className="flex items-center justify-between gap-3 mb-3">
                                    <h3 className="text-sm font-semibold text-gray-900">提交作业</h3>
                                    {!canSubmit && <span className="text-xs text-amber-600">互评已开启，提交已锁定</span>}
                                </div>
                                <textarea
                                    value={content}
                                    onChange={(event) => setContent(event.target.value)}
                                    disabled={!canSubmit || submitting}
                                    rows={6}
                                    placeholder="在此输入本次作业内容"
                                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-60 resize-none"
                                />
                                {renderAttachments(detail.assignment?.file_url)}

                                {canSubmit && (
                                    <div
                                        className={clsx(
                                            'mt-3 border-2 border-dashed rounded-lg p-3 cursor-pointer transition-colors',
                                            dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 bg-gray-50 hover:border-gray-300',
                                        )}
                                        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
                                        onDragLeave={() => setDragOver(false)}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            setDragOver(false);
                                            if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
                                        }}
                                        onClick={() => fileInputRef.current?.click()}
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            multiple
                                            accept={ALLOWED_EXTENSIONS.join(',')}
                                            className="hidden"
                                            onChange={(event) => {
                                                if (event.target.files) addFiles(event.target.files);
                                                event.target.value = '';
                                            }}
                                        />
                                        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                                            <Upload className="w-4 h-4" />
                                            <span>拖拽附件到此处或点击选择，最多 {MAX_FILES} 个</span>
                                        </div>
                                    </div>
                                )}

                                {files.length > 0 && (
                                    <div className="mt-2 space-y-1.5">
                                        {files.map((item, index) => (
                                            <div key={`${item.file.name}-${index}`} className={clsx('flex items-center gap-2 rounded-lg border px-3 py-2 text-xs', item.error ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50')}>
                                                <Paperclip className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                <span className="truncate flex-1 text-gray-700">{item.file.name}</span>
                                                {item.error && <span className="text-red-500">{item.error}</span>}
                                                {item.progress > 0 && !item.error && <span className="text-gray-400">{item.progress}%</span>}
                                                <button onClick={() => removeFile(index)} className="text-gray-400 hover:text-red-500">
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="mt-3 flex justify-end">
                                    <button
                                        onClick={handleSubmit}
                                        disabled={!canSubmit || submitting || files.some(file => !!file.error)}
                                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <Send className="w-4 h-4" />
                                        {submitting ? '提交中...' : detail.assignment ? '更新提交' : '提交作业'}
                                    </button>
                                </div>
                            </section>

                            <section className="border border-gray-200 rounded-lg p-4">
                                <h3 className="text-sm font-semibold text-gray-900 mb-3">自评</h3>
                                {!detail.assignment ? (
                                    <p className="text-sm text-gray-400">提交作业后可填写自评。</p>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-[120px,1fr,auto] gap-3 items-start">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={selfScore}
                                            onChange={(event) => setSelfScore(event.target.value)}
                                            placeholder="0-100"
                                            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                        />
                                        <textarea
                                            value={selfComment}
                                            onChange={(event) => setSelfComment(event.target.value)}
                                            rows={2}
                                            placeholder="写下你对自己作品的评价"
                                            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                                        />
                                        <button onClick={handleSelfReview} disabled={selfSaving} className="px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-black disabled:opacity-50">
                                            {selfSaving ? '保存中...' : '保存自评'}
                                        </button>
                                    </div>
                                )}
                            </section>

                            <section className="border border-gray-200 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <ClipboardCheck className="w-4 h-4 text-amber-500" />
                                    <h3 className="text-sm font-semibold text-gray-900">匿名互评</h3>
                                </div>
                                {detail.peer_reviews.length === 0 ? (
                                    <p className="text-sm text-gray-400">教师开启互评后，这里会显示分配给你的 5 份匿名作业。</p>
                                ) : (
                                    <div className="space-y-3">
                                        {detail.peer_reviews.map(review => {
                                            const draft = peerDrafts[review.id] || { score: '', comment: '' };
                                            return (
                                                <div key={review.id} className="border border-gray-200 rounded-lg p-3">
                                                    <div className="flex items-center justify-between gap-2 mb-2">
                                                        <span className="text-sm font-medium text-gray-900">{review.anonymous_label}</span>
                                                        <span className={clsx('text-[11px] px-2 py-0.5 rounded-full', review.status === 'submitted' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700')}>
                                                            {review.status === 'submitted' ? '已提交' : '待评价'}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-gray-700 whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3 mb-2">{review.content || '(仅附件提交)'}</p>
                                                    {renderAttachments(review.file_url)}
                                                    <div className="mt-3 grid grid-cols-1 md:grid-cols-[120px,1fr,auto] gap-3 items-start">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            max="100"
                                                            value={draft.score}
                                                            onChange={(event) => setPeerDrafts(prev => ({
                                                                ...prev,
                                                                [review.id]: { ...draft, score: event.target.value },
                                                            }))}
                                                            placeholder="0-100"
                                                            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                                        />
                                                        <textarea
                                                            value={draft.comment}
                                                            onChange={(event) => setPeerDrafts(prev => ({
                                                                ...prev,
                                                                [review.id]: { ...draft, comment: event.target.value },
                                                            }))}
                                                            rows={2}
                                                            placeholder="写下评价意见"
                                                            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                                                        />
                                                        <button onClick={() => handlePeerReview(review)} disabled={draft.saving} className="px-4 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                                                            {draft.saving ? '提交中...' : '提交互评'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>

                            <section className="border border-gray-200 rounded-lg p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                                    <h3 className="text-sm font-semibold text-gray-900">评价结果</h3>
                                </div>
                                {detail.assignment?.teacher_review && (
                                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 mb-3">
                                        <p className="text-xs font-medium text-emerald-700 mb-1">教师评分</p>
                                        <p className="text-lg font-semibold text-emerald-800">{(detail.assignment.teacher_review as any).score ?? '-'} 分</p>
                                        {(detail.assignment.teacher_review as any).comment && (
                                            <p className="text-sm text-emerald-700 mt-1">{(detail.assignment.teacher_review as any).comment}</p>
                                        )}
                                    </div>
                                )}
                                {detail.received_peer_reviews.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        {detail.received_peer_reviews.map(review => (
                                            <div key={review.id} className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-xs font-medium text-gray-500">{review.anonymous_label}</span>
                                                    <span className="text-sm font-semibold text-gray-900">{review.score ?? '-'} 分</span>
                                                </div>
                                                <p className="text-sm text-gray-600 whitespace-pre-wrap">{review.comment || '无评语'}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-400">暂无互评结果。</p>
                                )}
                            </section>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
};
