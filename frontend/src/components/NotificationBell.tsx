/**
 * 通知铃铛组件 — 右上角未读角标 + 下拉列表。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bell } from 'lucide-react';
import { api } from '../api';

interface Notification {
    id: string;
    type: string;
    title: string;
    content: string | null;
    is_read: boolean;
    job_id: string | null;
    created_at: string;
}

export const NotificationBell: React.FC = () => {
    const [open, setOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const ref = useRef<HTMLDivElement>(null);

    const loadUnreadCount = useCallback(async () => {
        try {
            const data = await api.notifications.unreadCount();
            setUnreadCount(data.unread_count || 0);
        } catch { /* ignore */ }
    }, []);

    const loadNotifications = useCallback(async () => {
        try {
            const data = await api.notifications.list();
            setNotifications(data);
        } catch { /* ignore */ }
    }, []);

    // 定期刷新未读数
    useEffect(() => {
        loadUnreadCount();
        const interval = setInterval(loadUnreadCount, 15000);
        return () => clearInterval(interval);
    }, [loadUnreadCount]);

    // 点击外部关闭
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleToggle = () => {
        if (!open) {
            loadNotifications();
        }
        setOpen(!open);
    };

    const handleMarkAllRead = async () => {
        try {
            await api.notifications.markAllRead();
            setUnreadCount(0);
            setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
        } catch { /* ignore */ }
    };

    const handleMarkRead = async (id: string) => {
        try {
            await api.notifications.markRead(id);
            setUnreadCount(prev => Math.max(0, prev - 1));
            setNotifications(prev =>
                prev.map(n => n.id === id ? { ...n, is_read: true } : n)
            );
        } catch { /* ignore */ }
    };

    // 监听 WS JOB_DONE 事件
    useEffect(() => {
        const handler = () => {
            loadUnreadCount();
        };
        window.addEventListener('job-done', handler);
        return () => window.removeEventListener('job-done', handler);
    }, [loadUnreadCount]);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={handleToggle}
                className="relative p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="通知"
            >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 sm:right-0 top-full mt-1 w-[calc(100vw-32px)] sm:w-72 max-w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-50 overflow-hidden -mr-2 sm:mr-0">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
                        <h3 className="text-xs font-semibold text-gray-700">通知</h3>
                        {unreadCount > 0 && (
                            <button
                                onClick={handleMarkAllRead}
                                className="text-[10px] text-blue-500 hover:text-blue-700"
                            >
                                全部已读
                            </button>
                        )}
                    </div>

                    <div className="max-h-60 overflow-y-auto">
                        {notifications.length === 0 ? (
                            <p className="text-center text-xs text-gray-300 py-6">暂无通知</p>
                        ) : (
                            notifications.map(n => (
                                <button
                                    key={n.id}
                                    onClick={() => !n.is_read && handleMarkRead(n.id)}
                                    className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                                        !n.is_read ? 'bg-blue-50/50' : ''
                                    }`}
                                >
                                    <div className="flex items-start gap-2">
                                        {!n.is_read && (
                                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mt-1.5 shrink-0" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-medium text-gray-800 truncate">
                                                {n.title}
                                            </p>
                                            {n.content && (
                                                <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                                                    {n.content}
                                                </p>
                                            )}
                                            <p className="text-[10px] text-gray-300 mt-0.5">
                                                {new Date(n.created_at).toLocaleString('zh-CN')}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
