/**
 * 修改密码弹窗。
 */
import React, { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { api } from '../../api';

interface Props {
    onClose: () => void;
}

export const ChangePasswordModal: React.FC<Props> = ({ onClose }) => {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showOld, setShowOld] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (newPassword.length < 6) {
            setError('新密码至少 6 位字符');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('两次输入的新密码不一致');
            return;
        }

        setLoading(true);
        try {
            await api.auth.changePassword(oldPassword, newPassword);
            setSuccess(true);
            setTimeout(() => onClose(), 1500);
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { detail?: string } } };
            setError(axiosErr?.response?.data?.detail || '修改失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
                <div className="flex items-center justify-between mb-5">
                    <h3 className="text-sm font-semibold text-gray-900">修改密码</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">✕</button>
                </div>

                {success ? (
                    <div className="text-center py-6">
                        <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                            <span className="text-xl">✓</span>
                        </div>
                        <p className="text-sm font-medium text-green-700">密码修改成功！</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* 旧密码 */}
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type={showOld ? 'text' : 'password'}
                                placeholder="当前密码"
                                value={oldPassword}
                                onChange={(e) => setOldPassword(e.target.value)}
                                className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-transparent rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowOld(!showOld)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showOld ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>

                        {/* 新密码 */}
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type={showNew ? 'text' : 'password'}
                                placeholder="新密码（至少 6 位）"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full pl-10 pr-10 py-2.5 bg-gray-50 border border-transparent rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                                required
                                minLength={6}
                            />
                            <button
                                type="button"
                                onClick={() => setShowNew(!showNew)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                            </button>
                        </div>

                        {/* 确认密码 */}
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="password"
                                placeholder="确认新密码"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:bg-white transition-all"
                                required
                            />
                        </div>

                        {error && (
                            <p className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm"
                        >
                            {loading ? '修改中...' : '确认修改'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};
