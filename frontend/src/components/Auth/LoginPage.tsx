/**
 * 登录/注册页面。
 * 从原项目迁移，改用拆分后的 useAuthStore。
 */
import React, { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { Mail, Lock, User } from 'lucide-react';
import clsx from 'clsx';

export const LoginPage: React.FC = () => {
    const { login, register } = useAuthStore();
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [formData, setFormData] = useState({
        email: '',
        password: '',
        name: '',
        role: 'student' as 'student' | 'teacher',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            if (isLogin) {
                await login(formData.email, formData.password);
            } else {
                await register(
                    formData.email,
                    formData.password,
                    formData.name,
                    formData.role
                );
            }
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
            const detail = axiosErr?.response?.data?.detail;
            setError(
                typeof detail === 'string'
                    ? detail
                    : axiosErr?.message || '操作失败'
            );
        } finally {
            setLoading(false);
        }
    };

    const fillTestAccount = (type: 'teacher' | 'student') => {
        setFormData({
            ...formData,
            email: type === 'teacher' ? '302023572169@stu.edu' : '302023572001@stu.edu',
            password: '123456',
        });
    };

    return (
        <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center p-4">
            <div className="w-full max-w-[400px]">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
                    {/* Logo */}
                    <div className="flex justify-center mb-6">
                        <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white font-bold text-lg">
                            Co
                        </div>
                    </div>

                    <h1 className="text-xl font-medium text-gray-900 text-center mb-1">
                        {isLogin ? '登录 CoThink' : '创建账号'}
                    </h1>
                    <p className="text-sm text-gray-500 text-center mb-6">
                        {isLogin ? '继续使用协作学习平台' : '开始您的学习之旅'}
                    </p>

                    {/* 快捷登录 */}
                    {isLogin && (
                        <div className="flex gap-2 mb-6">
                            <button
                                type="button"
                                onClick={() => fillTestAccount('student')}
                                className="flex-1 py-2 px-3 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
                            >
                                学生测试账号
                            </button>
                            <button
                                type="button"
                                onClick={() => fillTestAccount('teacher')}
                                className="flex-1 py-2 px-3 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
                            >
                                教师测试账号
                            </button>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* 姓名 (仅注册) */}
                        {!isLogin && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    姓名
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="您的姓名"
                                        value={formData.name}
                                        onChange={(e) =>
                                            setFormData({ ...formData, name: e.target.value })
                                        }
                                        className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm transition-all"
                                        required={!isLogin}
                                    />
                                </div>
                            </div>
                        )}

                        {/* 邮箱 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                邮箱
                            </label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="email"
                                    placeholder="example@email.com"
                                    value={formData.email}
                                    onChange={(e) =>
                                        setFormData({ ...formData, email: e.target.value })
                                    }
                                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm transition-all"
                                    required
                                />
                            </div>
                        </div>

                        {/* 密码 */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                密码
                            </label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="password"
                                    placeholder="至少 6 位字符"
                                    value={formData.password}
                                    onChange={(e) =>
                                        setFormData({ ...formData, password: e.target.value })
                                    }
                                    className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm transition-all"
                                    required
                                    minLength={6}
                                />
                            </div>
                        </div>

                        {/* 角色选择 (仅注册) */}
                        {!isLogin && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                                    我是
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setFormData({ ...formData, role: 'student' })
                                        }
                                        className={clsx(
                                            'py-2.5 rounded-lg border text-sm font-medium transition-all',
                                            formData.role === 'student'
                                                ? 'bg-primary-light border-primary text-primary'
                                                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                                        )}
                                    >
                                        学生
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setFormData({ ...formData, role: 'teacher' })
                                        }
                                        className={clsx(
                                            'py-2.5 rounded-lg border text-sm font-medium transition-all',
                                            formData.role === 'teacher'
                                                ? 'bg-primary-light border-primary text-primary'
                                                : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                                        )}
                                    >
                                        教师
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 错误提示 */}
                        {error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
                                {error}
                            </div>
                        )}

                        {/* 提交按钮 */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2.5 bg-primary text-white font-medium rounded-lg hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                            {loading ? '处理中...' : isLogin ? '登录' : '创建账号'}
                        </button>
                    </form>

                    {/* 切换登录/注册 */}
                    <div className="mt-6 text-center">
                        <span className="text-sm text-gray-500">
                            {isLogin ? '还没有账号？' : '已有账号？'}
                        </span>
                        <button
                            onClick={() => {
                                setIsLogin(!isLogin);
                                setError(null);
                            }}
                            className="ml-1 text-sm font-medium text-primary hover:underline"
                        >
                            {isLogin ? '立即注册' : '去登录'}
                        </button>
                    </div>
                </div>

                <p className="mt-6 text-center text-xs text-gray-400">
                    CoThink AI 协作学习平台 · 让学习更高效
                </p>
            </div>
        </div>
    );
};
