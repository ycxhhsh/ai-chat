/**
 * 登录/注册页面 — Sprint 4 Glassmorphism 设计。
 */
import React, { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { Mail, Lock, User, Brain } from 'lucide-react';
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
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex items-center justify-center p-4 relative overflow-hidden">
            {/* 动态背景装饰 */}
            <div className="absolute top-0 left-0 w-96 h-96 bg-blue-200/30 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2 animate-pulse" style={{ animationDuration: '8s' }} />
            <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-indigo-200/30 rounded-full blur-3xl translate-x-1/3 translate-y-1/3 animate-pulse" style={{ animationDuration: '10s' }} />
            <div className="absolute top-1/3 right-1/4 w-64 h-64 bg-violet-200/20 rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s' }} />

            {/* Glassmorphism 卡片 */}
            <div className="relative z-10 w-full max-w-[420px]">
                <div className="bg-white/60 backdrop-blur-xl border border-white/50 shadow-2xl rounded-3xl p-8">
                    {/* Logo */}
                    <div className="flex justify-center mb-6">
                        <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Brain className="w-7 h-7 text-white" />
                        </div>
                    </div>

                    <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">
                        {isLogin ? '欢迎回来' : '创建账号'}
                    </h1>
                    <p className="text-sm text-gray-500 text-center mb-7">
                        {isLogin ? 'CoThink AI · 激发思考的协作外脑' : '开始您的协作学习之旅'}
                    </p>

                    {/* 快捷登录 */}
                    {isLogin && (
                        <div className="flex gap-2 mb-6">
                            <button
                                type="button"
                                onClick={() => fillTestAccount('student')}
                                className="flex-1 py-2.5 px-3 text-xs font-medium text-gray-600 bg-white/80 hover:bg-blue-50 hover:text-blue-600 rounded-xl border border-white/60 hover:border-blue-200 transition-all backdrop-blur-sm"
                            >
                                🎓 学生测试
                            </button>
                            <button
                                type="button"
                                onClick={() => fillTestAccount('teacher')}
                                className="flex-1 py-2.5 px-3 text-xs font-medium text-gray-600 bg-white/80 hover:bg-blue-50 hover:text-blue-600 rounded-xl border border-white/60 hover:border-blue-200 transition-all backdrop-blur-sm"
                            >
                                👩‍🏫 教师测试
                            </button>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* 姓名 (仅注册) */}
                        {!isLogin && (
                            <div className="relative">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="您的姓名"
                                    value={formData.name}
                                    onChange={(e) =>
                                        setFormData({ ...formData, name: e.target.value })
                                    }
                                    className="w-full pl-11 pr-4 py-3 bg-gray-50/80 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 text-sm transition-all backdrop-blur-sm"
                                    required={!isLogin}
                                />
                            </div>
                        )}

                        {/* 邮箱 */}
                        <div className="relative">
                            <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="email"
                                placeholder="example@email.com"
                                value={formData.email}
                                onChange={(e) =>
                                    setFormData({ ...formData, email: e.target.value })
                                }
                                className="w-full pl-11 pr-4 py-3 bg-gray-50/80 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 text-sm transition-all backdrop-blur-sm"
                                required
                            />
                        </div>

                        {/* 密码 */}
                        <div className="relative">
                            <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="password"
                                placeholder="至少 6 位字符"
                                value={formData.password}
                                onChange={(e) =>
                                    setFormData({ ...formData, password: e.target.value })
                                }
                                className="w-full pl-11 pr-4 py-3 bg-gray-50/80 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 text-sm transition-all backdrop-blur-sm"
                                required
                                minLength={6}
                            />
                        </div>

                        {/* 角色选择 (仅注册) */}
                        {!isLogin && (
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    onClick={() =>
                                        setFormData({ ...formData, role: 'student' })
                                    }
                                    className={clsx(
                                        'py-3 rounded-xl border text-sm font-medium transition-all',
                                        formData.role === 'student'
                                            ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
                                            : 'bg-white/60 border-transparent text-gray-600 hover:bg-white/80'
                                    )}
                                >
                                    🎓 学生
                                </button>
                                <button
                                    type="button"
                                    onClick={() =>
                                        setFormData({ ...formData, role: 'teacher' })
                                    }
                                    className={clsx(
                                        'py-3 rounded-xl border text-sm font-medium transition-all',
                                        formData.role === 'teacher'
                                            ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
                                            : 'bg-white/60 border-transparent text-gray-600 hover:bg-white/80'
                                    )}
                                >
                                    👩‍🏫 教师
                                </button>
                            </div>
                        )}

                        {/* 错误提示 */}
                        {error && (
                            <div className="p-3 bg-red-50/80 border border-red-200 rounded-xl text-red-600 text-sm backdrop-blur-sm">
                                {error}
                            </div>
                        )}

                        {/* 提交按钮 */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                            {loading ? '处理中...' : isLogin ? '登 录' : '创建账号'}
                        </button>
                    </form>

                    {/* 切换登录/注册 */}
                    <div className="mt-7 text-center">
                        <span className="text-sm text-gray-500">
                            {isLogin ? '还没有账号？' : '已有账号？'}
                        </span>
                        <button
                            onClick={() => {
                                setIsLogin(!isLogin);
                                setError(null);
                            }}
                            className="ml-1 text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline transition-colors"
                        >
                            {isLogin ? '立即注册' : '去登录'}
                        </button>
                    </div>
                </div>

                <p className="mt-6 text-center text-xs text-gray-400">
                    © 2026 CoThink AI · 让学习更高效
                </p>
            </div>
        </div>
    );
};
