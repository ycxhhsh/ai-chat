/**
 * 对话记录 Tab — 提取自 TeacherDashboard
 * B+A+C 统一视图：分组对话串 + 筛选 + 右侧详情面板
 */
import React, { useState, useMemo } from 'react';
import { api as apiTyped } from '../../api';
import clsx from 'clsx';
import {
    Download,
    RefreshCw,
    Eye,
    X,
    ChevronUp,
    ChevronDown,
} from 'lucide-react';

type ChatTypeFilter = 'all' | 'group' | 'personal';

interface MessageLogProps {
    messages: Array<Record<string, unknown>>;
    totalMessages: number;
    msgPage: number;
    students: Array<Record<string, unknown>>;
    chatTypeFilter: ChatTypeFilter;
    filterStudentId: string;
    setChatTypeFilter: (v: ChatTypeFilter) => void;
    setFilterStudentId: (v: string) => void;
    setMsgPage: (v: number) => void;
    loadMessages: (page?: number) => void;
}

export const MessageLog: React.FC<MessageLogProps> = ({
    messages,
    totalMessages,
    msgPage,
    students,
    chatTypeFilter,
    filterStudentId,
    setChatTypeFilter,
    setFilterStudentId,
    setMsgPage,
    loadMessages,
}) => {
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [selectedThread, setSelectedThread] = useState<string | null>(null);
    const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set());

    const groupedThreads = useMemo(() => {
        const groups = new Map<string, Array<Record<string, unknown>>>();
        for (const m of messages) {
            const isGroup = m.chat_type === 'group';
            // Fallback for deleted groups: merge them into a single list
            const key = isGroup
                ? (m.group_name ? `group-${m.group_name}` : 'group-deleted')
                : ((m.conversation_id as string) || (m.session_id as string) || 'unknown');

            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(m);
        }
        for (const arr of groups.values()) {
            arr.sort((a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime());
        }
        return Array.from(groups.entries()).map(([key, msgs]) => {
            const first = msgs[0];
            const last = msgs[msgs.length - 1];
            const chatType = first.chat_type as string;
            // Provide a fallback name if it's the deleted group thread
            const groupName = key === 'group-deleted' ? '未找到归属小组 (已解散)' : (first.group_name as string);
            const senders = [...new Set(msgs.map(m => (m.sender as Record<string, string>)?.name).filter(Boolean))];
            return { key, msgs, chatType, groupName, senders, firstTime: first.created_at as string, lastTime: last.created_at as string };
        });
    }, [messages]);

    const panelThread = selectedThread ? groupedThreads.find(t => t.key === selectedThread) : null;

    const handleExportUnifiedCsv = async () => {
        try {
            const blob = await apiTyped.teacher.exportUnifiedCsv();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `unified_messages_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (_e) {
            alert('导出失败');
        }
    };

    return (
        <div className="flex gap-4">
            {/* 左侧对话串列表 */}
            <div className={clsx('flex-1 min-w-0 transition-all', selectedThread && 'max-w-[55%]')}>
                <div className="flex flex-col gap-4 mb-6">
                    <div className="flex items-center justify-between">
                        <h1 className="text-xl font-bold text-gray-900">对话记录</h1>
                        <div className="flex gap-2">
                            <button onClick={handleExportUnifiedCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
                                <Download className="w-3.5 h-3.5" /> 导出 CSV
                            </button>
                            <button onClick={() => loadMessages(msgPage)} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                                <RefreshCw className="w-3.5 h-3.5" /> 刷新
                            </button>
                        </div>
                    </div>
                    {/* 筛选区 */}
                    <div className="flex items-center gap-3 bg-white p-3 rounded-lg border border-gray-200 flex-wrap">
                        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                            {([['all', '全部'], ['group', '小组对话'], ['personal', 'AI 1v1']] as const).map(([val, lbl]) => (
                                <button
                                    key={val}
                                    onClick={() => { setChatTypeFilter(val); setMsgPage(1); }}
                                    className={clsx(
                                        'px-3 py-1.5 text-xs rounded-md transition-colors font-medium',
                                        chatTypeFilter === val
                                            ? 'bg-white text-gray-900 shadow-sm'
                                            : 'text-gray-500 hover:text-gray-700'
                                    )}
                                >
                                    {lbl}
                                </button>
                            ))}
                        </div>
                        <select
                            value={filterStudentId}
                            onChange={(e) => { setFilterStudentId(e.target.value); setMsgPage(1); }}
                            className="px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:border-indigo-400 min-w-[140px]"
                        >
                            <option value="">全部学生</option>
                            {students.map((s) => (
                                <option key={s.user_id as string} value={s.user_id as string}>
                                    {s.name as string}
                                </option>
                            ))}
                        </select>
                        <button onClick={() => loadMessages(1)} className="px-4 py-1.5 text-sm bg-gray-900 text-white rounded-md hover:bg-gray-800">查询</button>
                        <button onClick={() => { setChatTypeFilter('all'); setFilterStudentId(''); setMsgPage(1); setTimeout(() => loadMessages(1), 0); }} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-600">重置</button>
                    </div>
                </div>

                {/* B: 分组对话串卡片 */}
                <div className="space-y-3">
                    {groupedThreads.map((thread) => {
                        const isExpanded = expandedGroups.has(thread.key);
                        const isSelected = selectedThread === thread.key;
                        const previewMsgs = isExpanded ? thread.msgs : thread.msgs.slice(0, 2);
                        return (
                            <div
                                key={thread.key}
                                className={clsx(
                                    'bg-white rounded-xl border overflow-hidden transition-all',
                                    isSelected ? 'border-indigo-400 ring-1 ring-indigo-200' : 'border-gray-200 hover:border-gray-300'
                                )}
                            >
                                {/* 对话串头部 */}
                                <div
                                    className="flex items-center gap-2 px-4 py-3 bg-gray-50/80 cursor-pointer"
                                    onClick={() => setExpandedGroups(prev => {
                                        const next = new Set(prev);
                                        next.has(thread.key) ? next.delete(thread.key) : next.add(thread.key);
                                        return next;
                                    })}
                                >
                                    <span className={clsx(
                                        'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                                        thread.chatType === 'personal' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'
                                    )}>
                                        {thread.chatType === 'personal' ? '🤖 AI 1v1' : `🟢 ${thread.groupName || '小组'}`}
                                    </span>
                                    <span className="text-xs text-gray-500 truncate">{thread.senders.join('、')}</span>
                                    <span className="text-[10px] text-gray-300 ml-auto flex-shrink-0">
                                        {thread.msgs.length} 条 · {new Date(thread.firstTime).toLocaleDateString('zh-CN')}
                                    </span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setSelectedThread(isSelected ? null : thread.key); }}
                                        className="p-1 text-gray-400 hover:text-indigo-600 transition-colors flex-shrink-0"
                                        title="查看完整对话"
                                    >
                                        <Eye className="w-3.5 h-3.5" />
                                    </button>
                                    <ChevronDown className={clsx('w-3.5 h-3.5 text-gray-400 transition-transform flex-shrink-0', isExpanded && 'rotate-180')} />
                                </div>

                                {/* 对话串内容 - 聊天气泡 */}
                                <div className="px-4 py-2 space-y-2">
                                    {previewMsgs.map((m) => {
                                        const sender = m.sender as Record<string, string>;
                                        const isAi = sender?.role === 'ai';
                                        const msgId = m.message_id as string;
                                        const content = m.content as string;
                                        const isMsgExpanded = expandedMsgs.has(msgId);
                                        const isLong = content && content.length > 150;
                                        return (
                                            <div key={msgId} className={clsx('flex gap-2', isAi && 'flex-row-reverse')}>
                                                <div className={clsx(
                                                    'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0 mt-0.5',
                                                    isAi ? 'bg-violet-100 text-violet-600' : 'bg-gray-200 text-gray-600'
                                                )}>
                                                    {isAi ? 'AI' : (sender?.name?.charAt(0) || '?')}
                                                </div>
                                                <div className={clsx(
                                                    'max-w-[80%] rounded-xl px-3 py-2 text-sm',
                                                    isAi ? 'bg-violet-50 text-gray-700' : 'bg-gray-100 text-gray-700'
                                                )}>
                                                    <p className={clsx(!isMsgExpanded && isLong && 'line-clamp-3')}>{content}</p>
                                                    {isLong && (
                                                        <button
                                                            onClick={() => setExpandedMsgs(prev => {
                                                                const next = new Set(prev);
                                                                next.has(msgId) ? next.delete(msgId) : next.add(msgId);
                                                                return next;
                                                            })}
                                                            className="text-[10px] text-indigo-500 hover:text-indigo-700 mt-1 block"
                                                        >
                                                            {isMsgExpanded ? '收起 ▲' : '展开全文 ▼'}
                                                        </button>
                                                    )}
                                                    <span className="text-[9px] text-gray-300 mt-1 block">
                                                        {sender?.name} · {new Date(m.created_at as string).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {!isExpanded && thread.msgs.length > 2 && (
                                        <button
                                            onClick={() => setExpandedGroups(prev => new Set(prev).add(thread.key))}
                                            className="text-xs text-indigo-500 hover:text-indigo-700 py-1 w-full text-center"
                                        >
                                            展开剩余 {thread.msgs.length - 2} 条消息...
                                        </button>
                                    )}
                                    {isExpanded && thread.msgs.length > 2 && (
                                        <button
                                            onClick={() => setExpandedGroups(prev => { const n = new Set(prev); n.delete(thread.key); return n; })}
                                            className="flex items-center justify-center gap-1 text-xs text-gray-400 hover:text-gray-600 py-1 w-full"
                                        >
                                            <ChevronUp className="w-3 h-3" /> 收起
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {groupedThreads.length === 0 && <div className="text-center py-8 text-gray-300 text-sm">暂无消息</div>}
                </div>

                {totalMessages > messages.length && (
                    <div className="flex items-center justify-center mt-6 mb-2">
                        <button
                            onClick={() => loadMessages(msgPage + 1)}
                            className="px-6 py-2.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-full transition-colors flex items-center gap-2"
                        >
                            <RefreshCw className="w-4 h-4" /> 加载更早的记录（已加载 {messages.length} / 共 {totalMessages} 条）
                        </button>
                    </div>
                )}
                {totalMessages > 0 && messages.length >= totalMessages && (
                    <div className="text-center py-6 text-xs text-gray-400">
                        已加载全部 {totalMessages} 条记录
                    </div>
                )}
            </div>

            {/* C: 右侧详情面板 */}
            {panelThread && (
                <div className="w-[45%] flex-shrink-0 bg-white rounded-xl border border-gray-200 flex flex-col max-h-[calc(100vh-180px)] sticky top-0">
                    {/* 面板头 */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                        <div className="flex items-center gap-2">
                            <span className={clsx(
                                'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                                panelThread.chatType === 'personal' ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'
                            )}>
                                {panelThread.chatType === 'personal' ? '🤖 AI 1v1' : `🟢 ${panelThread.groupName || '小组'}`}
                            </span>
                            <span className="text-sm font-medium text-gray-700">{panelThread.senders.join('、')}</span>
                            <span className="text-[10px] text-gray-400">{panelThread.msgs.length} 条消息</span>
                        </div>
                        <button onClick={() => setSelectedThread(null)} className="p-1 text-gray-400 hover:text-gray-600">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    {/* 面板消息流 */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                        {panelThread.msgs.map((m) => {
                            const sender = m.sender as Record<string, string>;
                            const isAi = sender?.role === 'ai';
                            return (
                                <div key={m.message_id as string} className={clsx('flex gap-2', isAi && 'flex-row-reverse')}>
                                    <div className={clsx(
                                        'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium flex-shrink-0',
                                        isAi ? 'bg-violet-100 text-violet-600' : 'bg-gray-200 text-gray-600'
                                    )}>
                                        {isAi ? 'AI' : (sender?.name?.charAt(0) || '?')}
                                    </div>
                                    <div className={clsx(
                                        'max-w-[85%] rounded-xl px-3 py-2',
                                        isAi ? 'bg-violet-50' : 'bg-gray-50'
                                    )}>
                                        <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.content as string}</p>
                                        <span className="text-[9px] text-gray-300 mt-1 block">
                                            {sender?.name} · {new Date(m.created_at as string).toLocaleString('zh-CN')}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
