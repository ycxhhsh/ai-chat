/**
 * 学生作业提交面板。
 * 包含：文本编辑 → 文件上传 → 提交 → 历史列表 → 评分详情展开。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Send, FileText, ChevronDown, ChevronUp, Clock, CheckCircle, Star, RefreshCw, Paperclip, X, Upload } from 'lucide-react';
import clsx from 'clsx';
import { api as apiTyped } from '../../api';
import type { Assignment } from '../../types';

const statusLabels: Record<string, { text: string; color: string }> = {
    submitted: { text: '已提交', color: 'bg-blue-100 text-blue-700' },
    ai_graded: { text: 'AI 已评分', color: 'bg-violet-100 text-violet-700' },
    reviewed: { text: '教师已复核', color: 'bg-emerald-100 text-emerald-700' },
};

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.png', '.jpg', '.jpeg', '.gif'];
const MAX_FILES = 3;
const MAX_SIZE = 20 * 1024 * 1024; // 20MB

interface UploadedFile {
    file: File;
    progress: number;
    url?: string;
    error?: string;
}

export const AssignmentPanel: React.FC = () => {
    const [content, setContent] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [files, setFiles] = useState<UploadedFile[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const validateFile = (file: File): string | null => {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase();
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
            return `不支持的格式 (${ext})，仅允许: ${ALLOWED_EXTENSIONS.join(', ')}`;
        }
        if (file.size > MAX_SIZE) {
            return `文件过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，最大 20MB`;
        }
        return null;
    };

    const addFiles = (newFiles: FileList | File[]) => {
        const remaining = MAX_FILES - files.length;
        if (remaining <= 0) {
            alert(`最多添加 ${MAX_FILES} 个文件`);
            return;
        }
        const toAdd = Array.from(newFiles).slice(0, remaining);
        const validated: UploadedFile[] = toAdd.map(file => {
            const err = validateFile(file);
            return { file, progress: 0, error: err || undefined };
        });
        setFiles(prev => [...prev, ...validated]);
    };

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files);
        }
    };

    const handleSubmit = async () => {
        if ((!content.trim() && files.length === 0) || submitting) return;
        // Check for file errors
        if (files.some(f => f.error)) {
            alert('请移除有错误的文件后再提交');
            return;
        }
        setSubmitting(true);
        try {
            // Step 1: Upload files first
            const uploadedUrls: string[] = [];
            for (let i = 0; i < files.length; i++) {
                const f = files[i];
                setFiles(prev => prev.map((pf, j) => j === i ? { ...pf, progress: 30 } : pf));
                const result = await apiTyped.upload.file(f.file);
                uploadedUrls.push(result.file_url);
                setFiles(prev => prev.map((pf, j) => j === i ? { ...pf, progress: 100, url: result.file_url } : pf));
            }

            // Step 2: Submit assignment with file URLs
            const fileUrl = uploadedUrls.length > 0 ? uploadedUrls.join(',') : undefined;
            await apiTyped.assignments.submit(content.trim() || '(附件提交)', fileUrl);

            setContent('');
            setFiles([]);
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

    const formatFileSize = (bytes: number) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const renderAttachments = (fileUrl: string | undefined | null) => {
        if (!fileUrl) return null;
        const urls = fileUrl.split(',').filter(Boolean);
        if (urls.length === 0) return null;
        return (
            <div className="mt-2">
                <h4 className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
                    <Paperclip className="w-3 h-3" /> 附件 ({urls.length})
                </h4>
                <div className="space-y-1">
                    {urls.map((url, i) => {
                        const name = url.split('/').pop()?.replace(/^[a-f0-9]+_/, '') || '附件';
                        const isImage = /\.(png|jpg|jpeg|gif)$/i.test(url);
                        return (
                            <div key={i} className="flex items-center gap-2">
                                <a
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline truncate flex items-center gap-1"
                                >
                                    {isImage ? '🖼️' : '📄'} {name}
                                </a>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
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
                    rows={5}
                    className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent resize-none transition-all"
                />

                {/* 文件上传区 */}
                <div
                    className={clsx(
                        'mt-3 border-2 border-dashed rounded-lg p-3 transition-all cursor-pointer',
                        dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-gray-200 hover:border-gray-300 bg-gray-50/50',
                    )}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept={ALLOWED_EXTENSIONS.join(',')}
                        className="hidden"
                        onChange={(e) => {
                            if (e.target.files) addFiles(e.target.files);
                            e.target.value = '';
                        }}
                    />
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
                        <Upload className="w-4 h-4" />
                        <span>拖拽文件到此处或点击选择（最多 {MAX_FILES} 个，支持 PDF/Word/图片）</span>
                    </div>
                </div>

                {/* 已选文件列表 */}
                {files.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                        {files.map((f, i) => (
                            <div
                                key={i}
                                className={clsx(
                                    'flex items-center gap-2 px-3 py-2 rounded-lg text-xs',
                                    f.error ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-200',
                                )}
                            >
                                <Paperclip className="w-3 h-3 text-gray-400 shrink-0" />
                                <span className="truncate text-gray-700 flex-1">{f.file.name}</span>
                                <span className="text-gray-400 shrink-0">{formatFileSize(f.file.size)}</span>
                                {f.error && <span className="text-red-500 shrink-0">{f.error}</span>}
                                {f.progress > 0 && f.progress < 100 && !f.error && (
                                    <div className="w-16 h-1 bg-gray-200 rounded-full overflow-hidden shrink-0">
                                        <div
                                            className="h-full bg-indigo-500 rounded-full transition-all"
                                            style={{ width: `${f.progress}%` }}
                                        />
                                    </div>
                                )}
                                {f.progress === 100 && <span className="text-green-500 shrink-0">✓</span>}
                                <button
                                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                                    className="text-gray-300 hover:text-red-400 shrink-0"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex items-center justify-between mt-3">
                    <span className="text-[11px] text-gray-300">
                        {content.length} 字{files.length > 0 ? ` · ${files.length} 个附件` : ''}
                    </span>
                    <button
                        onClick={handleSubmit}
                        disabled={(!content.trim() && files.length === 0) || submitting || files.some(f => !!f.error)}
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
                                        {(a as any).file_url && (
                                            <Paperclip className="w-3 h-3 text-gray-400 shrink-0" />
                                        )}
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

                                        {/* 附件 */}
                                        {renderAttachments((a as any).file_url)}

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
