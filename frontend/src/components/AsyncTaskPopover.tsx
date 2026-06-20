import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Loader2, RotateCw, X } from 'lucide-react';
import { useAsyncTaskStore, type AsyncTask } from '../store/useAsyncTaskStore';

interface AsyncTaskPopoverProps {
    onRetry?: (task: AsyncTask) => void;
}

const statusLabel: Record<AsyncTask['status'], string> = {
    queued: '排队中',
    running: '处理中',
    streaming: '生成中',
    succeeded: '已完成',
    failed: '失败',
};

export const AsyncTaskPopover: React.FC<AsyncTaskPopoverProps> = ({ onRetry }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const tasks = useAsyncTaskStore((state) => state.tasks);
    const dismissTask = useAsyncTaskStore((state) => state.dismissTask);
    const visibleTasks = useMemo(() => {
        return Object.values(tasks)
            .filter((task) =>
                task.status === 'queued'
                || task.status === 'running'
                || task.status === 'streaming'
                || task.status === 'failed'
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 5);
    }, [tasks]);

    useEffect(() => {
        const handler = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    if (visibleTasks.length === 0) return null;

    const failedCount = visibleTasks.filter((task) => task.status === 'failed').length;
    const runningCount = visibleTasks.length - failedCount;

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen((value) => !value)}
                className="relative flex items-center gap-1.5 px-2 py-1.5 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="AI 任务状态"
            >
                {runningCount > 0 ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                    <Activity className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">AI 任务 {visibleTasks.length}</span>
                {failedCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {failedCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 top-full mt-1 w-[calc(100vw-32px)] sm:w-80 max-w-80 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden">
                    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
                        <h3 className="text-xs font-semibold text-gray-700">AI 任务</h3>
                    </div>
                    <div className="max-h-72 overflow-y-auto">
                        {visibleTasks.map((task) => (
                            <div key={task.taskId} className="px-3 py-2.5 border-b border-gray-50">
                                <div className="flex items-start gap-2">
                                    {task.status === 'failed' ? (
                                        <span className="mt-1.5 w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                    ) : (
                                        <Loader2 className="mt-0.5 w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="text-xs font-medium text-gray-800 truncate">{task.title}</p>
                                            <span className="text-[10px] text-gray-400 shrink-0">{statusLabel[task.status]}</span>
                                        </div>
                                        <p className={`mt-0.5 text-[11px] ${task.status === 'failed' ? 'text-red-500' : 'text-gray-400'}`}>
                                            {task.status === 'failed'
                                                ? task.errorMessage || '任务失败，请稍后重试'
                                                : task.progressText || statusLabel[task.status]}
                                        </p>
                                        {task.status === 'failed' && (
                                            <div className="mt-2 flex items-center gap-2">
                                                {task.retryable && onRetry && (
                                                    <button
                                                        onClick={() => onRetry(task)}
                                                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md"
                                                    >
                                                        <RotateCw className="w-3 h-3" />
                                                        重试
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => dismissTask(task.taskId)}
                                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100 rounded-md"
                                                >
                                                    <X className="w-3 h-3" />
                                                    关闭
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
