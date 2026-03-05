/**
 * 学生端侧边栏 — 小组列表、AI 对话列表、频道切换、在线状态。
 */
import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { useGroupStore } from '../../store/useGroupStore';
import { useChatStore } from '../../store/useChatStore';
import { useAiConversationStore } from '../../store/useAiConversationStore';
import {
    Users,
    MessageSquare,
    Plus,
    Link2,
    LogOut,
    Bot,
    FileText,
    Trash2,
    MessageCirclePlus,
    Copy,
    Check,
} from 'lucide-react';
import clsx from 'clsx';

type ChannelType = 'group' | 'ai' | 'assignment';

interface Props {
    activeChannel: ChannelType;
    onChannelChange: (channel: ChannelType) => void;
}

function timeAgo(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}天前`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export const Sidebar: React.FC<Props> = ({ activeChannel, onChannelChange }) => {
    const { user, logout } = useAuthStore();
    const { groups, currentGroupId, fetchGroups, createGroup, joinGroup, deleteGroup, setCurrentGroup } = useGroupStore();
    const {
        conversations,
        currentConversationId,
        fetchConversations,
        createConversation,
        selectConversation,
        deleteConversation,
    } = useAiConversationStore();

    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showJoinModal, setShowJoinModal] = useState(false);
    const [groupName, setGroupName] = useState('');
    const [inviteCode, setInviteCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [createdInviteCode, setCreatedInviteCode] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        fetchGroups().catch(() => { });
    }, [fetchGroups]);

    // AI 频道激活时加载对话列表
    useEffect(() => {
        if (activeChannel === 'ai') {
            fetchConversations().catch(() => { });
        }
    }, [activeChannel, fetchConversations]);

    const handleCreateGroup = async () => {
        if (!groupName.trim()) return;
        setLoading(true);
        try {
            const group = await createGroup(groupName.trim());
            setCurrentGroup(group.id);
            setGroupName('');
            setShowCreateModal(false);
            // 显示邀请码
            setCreatedInviteCode(group.invite_code);
            setCopied(false);
            onChannelChange('group');
        } catch (e) {
            console.error('Create group failed:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleCopyInviteCode = () => {
        if (!createdInviteCode) return;
        navigator.clipboard.writeText(createdInviteCode).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleJoinGroup = async () => {
        if (!inviteCode.trim()) return;
        setLoading(true);
        try {
            await joinGroup(inviteCode.trim());
            setInviteCode('');
            setShowJoinModal(false);
            onChannelChange('group');
        } catch (e) {
            console.error('Join group failed:', e);
        } finally {
            setLoading(false);
        }
    };

    const handleNewConversation = async () => {
        try {
            await createConversation();
            // 只清空 AI 消息，不清空小组消息
            useChatStore.getState().setAiMessages([]);
            useChatStore.getState().resetAiStream();
        } catch (e) {
            console.error('Create conversation failed:', e);
        }
    };

    const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        if (!confirm('确定删除此对话？')) return;
        try {
            await deleteConversation(id);
        } catch (err) {
            console.error('Delete conversation failed:', err);
        }
    };

    const channels: { type: ChannelType; icon: React.ElementType; label: string }[] = [
        { type: 'group', icon: MessageSquare, label: '小组讨论' },
        { type: 'ai', icon: Bot, label: 'AI 导师' },
        { type: 'assignment', icon: FileText, label: '作业提交' },
    ];

    return (
        <div className="w-64 h-full bg-white border-r border-gray-200 flex flex-col">
            {/* 用户信息 */}
            <div className="p-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center text-sm font-medium">
                        {user?.name?.charAt(0) || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{user?.name}</p>
                        <p className="text-[11px] text-gray-400">{user?.role === 'teacher' ? '教师' : '学生'}</p>
                    </div>
                    <button
                        onClick={logout}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        title="退出登录"
                    >
                        <LogOut className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* 频道切换 */}
            <div className="p-2">
                {channels.map(({ type, icon: Icon, label }) => (
                    <button
                        key={type}
                        onClick={() => onChannelChange(type)}
                        className={clsx(
                            'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors mb-0.5',
                            activeChannel === type
                                ? 'bg-primary-light text-primary font-medium'
                                : 'text-gray-600 hover:bg-gray-50'
                        )}
                    >
                        <Icon className="w-4 h-4" />
                        {label}
                    </button>
                ))}
            </div>

            {/* 动态内容区 */}
            <div className="flex-1 overflow-y-auto px-2 py-1">
                {activeChannel === 'ai' ? (
                    /* ── AI 对话列表 ── */
                    <>
                        <div className="flex items-center justify-between px-3 py-1.5">
                            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">对话</p>
                            <button
                                onClick={handleNewConversation}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary-light rounded-lg transition-colors"
                                title="新建对话"
                            >
                                <MessageCirclePlus className="w-3.5 h-3.5" />
                                新对话
                            </button>
                        </div>

                        {conversations.length === 0 ? (
                            <div className="text-center py-8">
                                <Bot className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                                <p className="text-xs text-gray-300">暂无对话</p>
                                <button
                                    onClick={handleNewConversation}
                                    className="mt-2 text-xs text-primary hover:underline"
                                >
                                    开始新对话
                                </button>
                            </div>
                        ) : (
                            conversations.map((c) => (
                                <div
                                    key={c.conversation_id}
                                    onClick={() => selectConversation(c.conversation_id)}
                                    className={clsx(
                                        'group w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors mb-0.5 cursor-pointer',
                                        c.conversation_id === currentConversationId
                                            ? 'bg-gray-100 text-gray-900'
                                            : 'text-gray-600 hover:bg-gray-50'
                                    )}
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className={clsx(
                                            'text-sm truncate',
                                            c.conversation_id === currentConversationId && 'font-medium'
                                        )}>
                                            {c.title}
                                        </p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">
                                            {timeAgo(c.updated_at)}
                                            {c.message_count > 0 && ` · ${c.message_count}条`}
                                        </p>
                                    </div>
                                    <button
                                        onClick={(e) => handleDeleteConversation(e, c.conversation_id)}
                                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 rounded transition-all"
                                        title="删除对话"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))
                        )}
                    </>
                ) : activeChannel === 'assignment' ? (
                    /* ── 作业频道：不显示小组列表 ── */
                    <div className="text-center py-8">
                        <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                        <p className="text-xs text-gray-400">在右侧面板中提交和查看作业</p>
                    </div>
                ) : (
                    /* ── 小组列表 ── */
                    <>
                        <div className="flex items-center justify-between px-3 py-1.5">
                            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">小组</p>
                            <div className="flex gap-1">
                                <button
                                    onClick={() => setShowCreateModal(true)}
                                    className="p-1 text-gray-400 hover:text-primary hover:bg-primary-light rounded transition-colors"
                                    title="创建小组"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                </button>
                                <button
                                    onClick={() => setShowJoinModal(true)}
                                    className="p-1 text-gray-400 hover:text-primary hover:bg-primary-light rounded transition-colors"
                                    title="加入小组"
                                >
                                    <Link2 className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>

                        {groups.length === 0 ? (
                            <p className="text-xs text-gray-300 text-center py-4">暂无小组</p>
                        ) : (
                            groups.map((g) => {
                                const isCreator = user?.user_id === g.created_by;
                                return (
                                    <div
                                        key={g.id}
                                        className={clsx(
                                            'group w-full rounded-lg mb-1 transition-colors',
                                            g.id === currentGroupId
                                                ? 'bg-gray-100'
                                                : 'hover:bg-gray-50'
                                        )}
                                    >
                                        <button
                                            onClick={() => {
                                                setCurrentGroup(g.id);
                                                onChannelChange('group');
                                            }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-left"
                                        >
                                            <Users className="w-4 h-4 text-gray-400 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <span className={clsx(
                                                    'text-sm truncate block',
                                                    g.id === currentGroupId ? 'text-gray-900 font-medium' : 'text-gray-600'
                                                )}>
                                                    {g.name}
                                                </span>
                                                <span className="text-[10px] text-gray-400 flex items-center gap-1 mt-0.5">
                                                    邀请码:
                                                    <code className="bg-gray-100 px-1 py-0.5 rounded font-mono text-indigo-500 select-all">
                                                        {g.invite_code}
                                                    </code>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            navigator.clipboard.writeText(g.invite_code);
                                                        }}
                                                        className="p-0.5 text-gray-300 hover:text-indigo-500 transition-colors"
                                                        title="复制邀请码"
                                                    >
                                                        <Copy className="w-3 h-3" />
                                                    </button>
                                                </span>
                                            </div>
                                            {isCreator && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (confirm(`确定删除小组「${g.name}」？此操作不可恢复。`)) {
                                                            deleteGroup(g.id).catch(err => {
                                                                console.error('Delete group failed:', err);
                                                                alert('删除失败');
                                                            });
                                                        }
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-300 hover:text-red-500 rounded transition-all shrink-0"
                                                    title="删除小组"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </>
                )}
            </div>

            {/* 创建小组弹窗 */}
            {showCreateModal && (
                <Modal
                    title="创建小组"
                    onClose={() => setShowCreateModal(false)}
                >
                    <input
                        type="text"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        placeholder="小组名称"
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus
                    />
                    <button
                        onClick={handleCreateGroup}
                        disabled={loading || !groupName.trim()}
                        className="w-full mt-3 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
                    >
                        {loading ? '创建中...' : '创建'}
                    </button>
                </Modal>
            )}

            {/* 加入小组弹窗 */}
            {showJoinModal && (
                <Modal
                    title="加入小组"
                    onClose={() => setShowJoinModal(false)}
                >
                    <input
                        type="text"
                        value={inviteCode}
                        onChange={(e) => setInviteCode(e.target.value)}
                        placeholder="输入邀请码"
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        autoFocus
                    />
                    <button
                        onClick={handleJoinGroup}
                        disabled={loading || !inviteCode.trim()}
                        className="w-full mt-3 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors"
                    >
                        {loading ? '加入中...' : '加入'}
                    </button>
                </Modal>
            )}

            {/* 邀请码展示弹窗 */}
            {createdInviteCode && (
                <Modal
                    title="🎉 小组创建成功"
                    onClose={() => setCreatedInviteCode(null)}
                >
                    <p className="text-sm text-gray-500 mb-3">将以下邀请码分享给同学，即可加入你的小组：</p>
                    <div className="flex items-center gap-2 p-3 bg-primary-light rounded-lg">
                        <span className="flex-1 text-center text-xl font-bold tracking-widest text-primary select-all">
                            {createdInviteCode}
                        </span>
                        <button
                            onClick={handleCopyInviteCode}
                            className="p-2 text-primary hover:bg-white rounded-lg transition-colors"
                            title="复制邀请码"
                        >
                            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        </button>
                    </div>
                    {copied && (
                        <p className="text-xs text-green-500 text-center mt-2">已复制到剪贴板 ✓</p>
                    )}
                    <button
                        onClick={() => setCreatedInviteCode(null)}
                        className="w-full mt-4 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-hover transition-colors"
                    >
                        知道了
                    </button>
                </Modal>
            )}
        </div>
    );
};

// ── 简易 Modal ──

function Modal({
    title,
    onClose,
    children,
}: {
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}) {
    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>
                {children}
            </div>
        </div>
    );
}
