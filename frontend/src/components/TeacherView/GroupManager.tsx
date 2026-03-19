/**
 * 小组管理 Tab — 教师端查看/管理所有学生小组。
 */
import React, { useState } from 'react';
import { api } from '../../api';
import {
    ChevronDown, ChevronUp, UserMinus, ArrowRightLeft,
    Pencil, Trash2, RefreshCw, Users, Copy, Check,
} from 'lucide-react';

interface GroupMember {
    user_id: string;
    name: string;
    email: string;
    role: string;
    joined_at: string;
}

interface GroupData {
    id: string;
    name: string;
    invite_code: string;
    created_by: string;
    created_at: string;
    member_count: number;
    members: GroupMember[];
}

interface GroupManagerProps {
    groups: GroupData[];
    loadGroups: () => void;
}

export const GroupManager: React.FC<GroupManagerProps> = ({ groups, loadGroups }) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [renameId, setRenameId] = useState<string | null>(null);
    const [renameName, setRenameName] = useState('');
    const [transferringMember, setTransferringMember] = useState<{ groupId: string; userId: string; userName: string } | null>(null);
    const [loading, setLoading] = useState(false);
    const [copiedCode, setCopiedCode] = useState<string | null>(null);

    const handleRemoveMember = async (groupId: string, userId: string, name: string) => {
        if (!confirm(`确定将「${name}」移出小组吗？`)) return;
        setLoading(true);
        try {
            await api.teacher.removeGroupMember(groupId, userId);
            loadGroups();
        } catch (err: any) {
            alert(err?.response?.data?.detail || '操作失败');
        } finally {
            setLoading(false);
        }
    };

    const handleTransfer = async (targetGroupId: string) => {
        if (!transferringMember) return;
        setLoading(true);
        try {
            await api.teacher.transferGroupMember(
                transferringMember.groupId,
                transferringMember.userId,
                targetGroupId,
            );
            setTransferringMember(null);
            loadGroups();
        } catch (err: any) {
            alert(err?.response?.data?.detail || '转移失败');
        } finally {
            setLoading(false);
        }
    };

    const handleRename = async (groupId: string) => {
        if (!renameName.trim()) return;
        setLoading(true);
        try {
            await api.teacher.renameGroup(groupId, renameName.trim());
            setRenameId(null);
            setRenameName('');
            loadGroups();
        } catch (err: any) {
            alert(err?.response?.data?.detail || '重命名失败');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (groupId: string, name: string) => {
        if (!confirm(`确定删除小组「${name}」吗？此操作不可恢复，所有成员将被移出。`)) return;
        setLoading(true);
        try {
            await api.teacher.deleteGroup(groupId);
            loadGroups();
        } catch (err: any) {
            alert(err?.response?.data?.detail || '删除失败');
        } finally {
            setLoading(false);
        }
    };

    const copyInviteCode = (code: string) => {
        navigator.clipboard.writeText(code);
        setCopiedCode(code);
        setTimeout(() => setCopiedCode(null), 2000);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-xl font-bold text-gray-900">小组管理</h1>
                <button
                    onClick={loadGroups}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> 刷新
                </button>
            </div>

            {groups.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">暂无小组</p>
                    <p className="text-xs text-gray-300 mt-1">学生可通过邀请码创建和加入小组</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {groups.map((group) => (
                        <div key={group.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden transition-shadow hover:shadow-sm">
                            {/* 小组头部 */}
                            <div
                                className="flex items-center justify-between px-5 py-4 cursor-pointer"
                                onClick={() => setExpandedId(expandedId === group.id ? null : group.id)}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                                        <Users className="w-5 h-5" />
                                    </div>
                                    <div className="min-w-0">
                                        {renameId === group.id ? (
                                            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="text"
                                                    value={renameName}
                                                    onChange={(e) => setRenameName(e.target.value)}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') handleRename(group.id); if (e.key === 'Escape') setRenameId(null); }}
                                                    className="px-2 py-1 text-sm border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400"
                                                    autoFocus
                                                />
                                                <button onClick={() => handleRename(group.id)} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">保存</button>
                                                <button onClick={() => setRenameId(null)} className="text-xs text-gray-400 hover:text-gray-600">取消</button>
                                            </div>
                                        ) : (
                                            <p className="text-sm font-semibold text-gray-900 truncate">{group.name}</p>
                                        )}
                                        <div className="flex items-center gap-3 mt-0.5">
                                            <span className="text-xs text-gray-400">{group.member_count} 人</span>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); copyInviteCode(group.invite_code); }}
                                                className="flex items-center gap-1 text-xs text-gray-400 hover:text-indigo-500 transition-colors"
                                                title="复制邀请码"
                                            >
                                                {copiedCode === group.invite_code ? (
                                                    <><Check className="w-3 h-3 text-green-500" /><span className="text-green-500">已复制</span></>
                                                ) : (
                                                    <><Copy className="w-3 h-3" /><span>{group.invite_code}</span></>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => { setRenameId(group.id); setRenameName(group.name); }}
                                        className="p-1.5 text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors"
                                        title="重命名"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        onClick={() => handleDelete(group.id, group.name)}
                                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                        title="删除小组"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    <div className="ml-1 text-gray-300">
                                        {expandedId === group.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    </div>
                                </div>
                            </div>

                            {/* 成员列表（展开） */}
                            {expandedId === group.id && (
                                <div className="border-t border-gray-100">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                                                <th className="px-5 py-2.5 text-left font-medium">姓名</th>
                                                <th className="px-5 py-2.5 text-left font-medium">邮箱</th>
                                                <th className="px-5 py-2.5 text-left font-medium">角色</th>
                                                <th className="px-5 py-2.5 text-left font-medium">加入时间</th>
                                                <th className="px-5 py-2.5 text-right font-medium">操作</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {group.members.map((m) => (
                                                <tr key={m.user_id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                                                    <td className="px-5 py-3 text-sm font-medium text-gray-900">{m.name}</td>
                                                    <td className="px-5 py-3 text-sm text-gray-500">{m.email}</td>
                                                    <td className="px-5 py-3">
                                                        <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded-full ${
                                                            m.role === 'admin'
                                                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                                                : 'bg-gray-50 text-gray-500 border border-gray-200'
                                                        }`}>
                                                            {m.role === 'admin' ? '组长' : '成员'}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-3 text-sm text-gray-400">
                                                        {m.joined_at ? new Date(m.joined_at).toLocaleDateString('zh-CN') : '-'}
                                                    </td>
                                                    <td className="px-5 py-3 text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <button
                                                                onClick={() => setTransferringMember({ groupId: group.id, userId: m.user_id, userName: m.name })}
                                                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                                                title="转移到其他小组"
                                                            >
                                                                <ArrowRightLeft className="w-3 h-3" /> 转移
                                                            </button>
                                                            <button
                                                                onClick={() => handleRemoveMember(group.id, m.user_id, m.name)}
                                                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-50 rounded-md transition-colors"
                                                                title="移出小组"
                                                            >
                                                                <UserMinus className="w-3 h-3" /> 移出
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            {group.members.length === 0 && (
                                                <tr>
                                                    <td colSpan={5} className="px-5 py-6 text-center text-sm text-gray-300">暂无成员</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* 转移成员弹窗 */}
            {transferringMember && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setTransferringMember(null)}>
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-gray-900">
                                转移成员 — {transferringMember.userName}
                            </h3>
                            <button onClick={() => setTransferringMember(null)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
                        </div>
                        <p className="text-xs text-gray-500 mb-3">选择目标小组：</p>
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                            {groups
                                .filter((g) => g.id !== transferringMember.groupId)
                                .map((g) => (
                                    <button
                                        key={g.id}
                                        onClick={() => handleTransfer(g.id)}
                                        disabled={loading}
                                        className="w-full flex items-center justify-between px-4 py-3 text-left bg-gray-50 hover:bg-indigo-50 rounded-xl transition-colors disabled:opacity-40"
                                    >
                                        <div>
                                            <p className="text-sm font-medium text-gray-900">{g.name}</p>
                                            <p className="text-xs text-gray-400 mt-0.5">{g.member_count} 人</p>
                                        </div>
                                        <ArrowRightLeft className="w-4 h-4 text-gray-400" />
                                    </button>
                                ))}
                            {groups.filter((g) => g.id !== transferringMember.groupId).length === 0 && (
                                <p className="text-sm text-gray-400 text-center py-4">没有其他可用小组</p>
                            )}
                        </div>
                        <div className="flex justify-end mt-4">
                            <button
                                onClick={() => setTransferringMember(null)}
                                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
