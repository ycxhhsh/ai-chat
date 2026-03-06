/**
 * 登录/注册页面 — Sprint 3 现代 50/50 split-screen 设计。
 */
import React, { useState } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { Mail, Lock, User, Brain, Users, Sparkles, BookOpen } from 'lucide-react';
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
        <div className="grid grid-cols-1 md:grid-cols-2 h-screen">
            {/* ── 左侧品牌区域 ── */}
            <div className="hidden md:flex flex-col items-center justify-center bg-gradient-to-br from-blue-600 via-indigo-700 to-indigo-800 text-white p-12 relative overflow-hidden">
                {/* 背景装饰圆 */}
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-white/5 rounded-full blur-3xl" />
                <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] bg-indigo-500/20 rounded-full blur-3xl" />
                <div className="absolute top-1/4 right-10 w-40 h-40 bg-blue-400/10 rounded-full blur-2xl" />

                <div className="relative z-10 max-w-md text-center">
                    {/* Logo */}
                    <div className="w-20 h-20 bg-white/15 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-8 border border-white/20 shadow-lg">
                        <Brain className="w-10 h-10 text-white" />
                    </div>

                    <h1 className="text-4xl font-bold tracking-tight mb-3">
                        CoThink AI
                    </h1>
                    <p className="text-xl font-light text-blue-100 mb-8">
                        激发思考的协作外脑
                    </p>

                    <div className="w-16 h-px bg-white/30 mx-auto mb-8" />

                    {/* 特性列表 */}
                    <div className="space-y-4 text-left">
                        <div className="flex items-center gap-3 text-blue-100">
                            <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
                                <Sparkles className="w-4.5 h-4.5" />
                            </div>
                            <span className="text-sm font-medium">AI 苏格拉底导师 · 启发式引导</span>
                        </div>
                        <div className="flex items-center gap-3 text-blue-100">
                            <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
                                <Users className="w-4.5 h-4.5" />
                            </div>
                            <span className="text-sm font-medium">小组协作空间 · 实时思维碰撞</span>
                        </div>
                        <div className="flex items-center gap-3 text-blue-100">
                            <div className="w-9 h-9 bg-white/10 rounded-lg flex items-center justify-center flex-shrink-0">
                                <BookOpen className="w-4.5 h-4.5" />
                            </div>
                            <span className="text-sm font-medium">CRDT 思维导图 · 可视化知识建构</span>
                        </div>
                    </div>
                </div>

                {/* 底部文字 */}
                <p className="absolute bottom-6 text-xs text-blue-200/60">
                    © 2026 CoThink AI · 让学习更高效
                </p>
            </div>

            {/* ── 右侧表单区域 ── */}
            <div className="flex items-center justify-center bg-white p-6 sm:p-12">
                <div className="w-full max-w-[400px]">
                    {/* 移动端 Logo */}
                    <div className="flex justify-center mb-6 md:hidden">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg">
                            <Brain className="w-6 h-6 text-white" />
                        </div>
                    </div>

                    <h1 className="text-2xl font-bold text-gray-900 mb-1">
                        {isLogin ? '欢迎回来' : '创建账号'}
                    </h1>
                    <p className="text-sm text-gray-500 mb-8">
                        {isLogin ? '登录以继续使用 CoThink AI' : '开始您的协作学习之旅'}
                    </p>

                    {/* 快捷登录 */}
                    {isLogin && (
                        <div className="flex gap-2 mb-6">
                            <button
                                type="button"
                                onClick={() => fillTestAccount('student')}
                                className="flex-1 py-2.5 px-3 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded-xl border border-transparent hover:border-blue-200 transition-all"
                            >
                                🎓 学生测试账号
                            </button>
                            <button
                                type="button"
                                onClick={() => fillTestAccount('teacher')}
                                className="flex-1 py-2.5 px-3 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-blue-50 hover:text-blue-600 rounded-xl border border-transparent hover:border-blue-200 transition-all"
                            >
                                👩‍🏫 教师测试账号
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
                                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="您的姓名"
                                        value={formData.name}
                                        onChange={(e) =>
                                            setFormData({ ...formData, name: e.target.value })
                                        }
                                        className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 text-sm transition-all"
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
                                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="email"
                                    placeholder="example@email.com"
                                    value={formData.email}
                                    onChange={(e) =>
                                        setFormData({ ...formData, email: e.target.value })
                                    }
                                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 text-sm transition-all"
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
                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="password"
                                    placeholder="至少 6 位字符"
                                    value={formData.password}
                                    onChange={(e) =>
                                        setFormData({ ...formData, password: e.target.value })
                                    }
                                    className="w-full pl-11 pr-4 py-3 bg-gray-50 border border-transparent rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500 text-sm transition-all"
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
                                            'py-3 rounded-xl border text-sm font-medium transition-all',
                                            formData.role === 'student'
                                                ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
                                                : 'bg-gray-50 border-transparent text-gray-600 hover:bg-gray-100'
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
                                                : 'bg-gray-50 border-transparent text-gray-600 hover:bg-gray-100'
                                        )}
                                    >
                                        👩‍🏫 教师
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 错误提示 */}
                        {error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm">
                                {error}
                            </div>
                        )}

                        {/* 提交按钮 */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                            {loading ? '处理中...' : isLogin ? '登 录' : '创建账号'}
                        </button>
                    </form>

                    {/* 切换登录/注册 */}
                    <div className="mt-8 text-center">
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
            </div>
        </div>
    );
};
