/**
 * 登录页 — 极简设计 + 鼠标跟随渐变背景。
 * 注册入口通过 REGISTRATION_OPEN 开关控制，方便后续开放。
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAuthStore } from '../../store/useAuthStore';
import { Mail, Lock, User } from 'lucide-react';
import clsx from 'clsx';

// ═══ 注册开关 ═══
// 设为 true 即可恢复注册功能
const REGISTRATION_OPEN = true;

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
    const [rememberMe, setRememberMe] = useState(true);

    // —— 鼠标跟随光晕 ——
    const containerRef = useRef<HTMLDivElement>(null);
    const blob1Ref = useRef<HTMLDivElement>(null);
    const blob2Ref = useRef<HTMLDivElement>(null);
    const blob3Ref = useRef<HTMLDivElement>(null);
    const mousePos = useRef({ x: 0.5, y: 0.5 });
    const currentPos = useRef({ b1x: 0, b1y: 0, b2x: 0, b2y: 0, b3x: 0, b3y: 0 });
    const rafRef = useRef<number>(0);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        mousePos.current = {
            x: (e.clientX - rect.left) / rect.width,
            y: (e.clientY - rect.top) / rect.height,
        };
    }, []);

    // 平滑插值动画 — 光晕缓慢跟随鼠标
    useEffect(() => {
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        const animate = () => {
            const { x, y } = mousePos.current;
            const c = currentPos.current;

            // blob1: 大范围跟随
            c.b1x = lerp(c.b1x, (x - 0.5) * 150, 0.03);
            c.b1y = lerp(c.b1y, (y - 0.5) * 150, 0.03);
            // blob2: 反向大范围，稍慢
            c.b2x = lerp(c.b2x, (0.5 - x) * 120, 0.02);
            c.b2y = lerp(c.b2y, (0.5 - y) * 120, 0.02);
            // blob3: 对角偏移
            c.b3x = lerp(c.b3x, (x - 0.3) * 100, 0.035);
            c.b3y = lerp(c.b3y, (y - 0.7) * 100, 0.035);

            if (blob1Ref.current) blob1Ref.current.style.transform = `translate(${c.b1x}%, ${c.b1y}%)`;
            if (blob2Ref.current) blob2Ref.current.style.transform = `translate(${c.b2x}%, ${c.b2y}%)`;
            if (blob3Ref.current) blob3Ref.current.style.transform = `translate(${c.b3x}%, ${c.b3y}%)`;

            rafRef.current = requestAnimationFrame(animate);
        };
        rafRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(rafRef.current);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            if (isLogin) {
                await login(formData.email, formData.password, rememberMe);
            } else {
                await register(formData.email, formData.password, formData.name, formData.role);
            }
        } catch (err: unknown) {
            const axiosErr = err as { response?: { data?: { detail?: string } }; message?: string };
            const detail = axiosErr?.response?.data?.detail;
            setError(typeof detail === 'string' ? detail : axiosErr?.message || '操作失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden select-none"
            style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #f8fafc 40%, #f5f0ff 100%)' }}
        >
            {/* ── 鼠标跟随彩色光晕 (Antigravity 风格) ── */}
            <div
                ref={blob1Ref}
                className="pointer-events-none absolute rounded-full"
                style={{
                    width: '60vw', height: '60vw', maxWidth: '900px', maxHeight: '900px',
                    top: '-20%', left: '-15%',
                    background: 'radial-gradient(circle, rgba(99,102,241,0.5) 0%, rgba(129,140,248,0.2) 40%, transparent 70%)',
                    filter: 'blur(60px)',
                }}
            />
            <div
                ref={blob2Ref}
                className="pointer-events-none absolute rounded-full"
                style={{
                    width: '55vw', height: '55vw', maxWidth: '850px', maxHeight: '850px',
                    bottom: '-15%', right: '-15%',
                    background: 'radial-gradient(circle, rgba(59,130,246,0.45) 0%, rgba(96,165,250,0.15) 40%, transparent 70%)',
                    filter: 'blur(50px)',
                }}
            />
            <div
                ref={blob3Ref}
                className="pointer-events-none absolute rounded-full"
                style={{
                    width: '45vw', height: '45vw', maxWidth: '700px', maxHeight: '700px',
                    top: '20%', left: '30%',
                    background: 'radial-gradient(circle, rgba(167,139,250,0.4) 0%, rgba(196,181,253,0.12) 40%, transparent 70%)',
                    filter: 'blur(40px)',
                }}
            />

            {/* ── 登录卡片 ── */}
            <div className="relative z-10 w-full max-w-[400px]">
                <div
                    className="backdrop-blur-2xl rounded-3xl px-8 py-10 sm:px-10 sm:py-12"
                    style={{
                        background: 'rgba(255,255,255,0.65)',
                        border: '1px solid rgba(255,255,255,0.7)',
                        boxShadow: '0 8px 40px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
                    }}
                >
                    {/* Logo + 品牌 */}
                    <div className="flex flex-col items-center mb-9">
                        {/* 水晶几何大脑 — 高精度三角网格 */}
                        <svg
                            width="72" height="72" viewBox="0 0 80 80" fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="mb-5"
                            style={{ filter: 'drop-shadow(0 4px 12px rgba(99,102,241,0.2))' }}
                        >
                            <defs>
                                <linearGradient id="bg" x1="10" y1="10" x2="70" y2="70" gradientUnits="userSpaceOnUse">
                                    <stop offset="0%" stopColor="#a5b4fc" />
                                    <stop offset="100%" stopColor="#6366f1" />
                                </linearGradient>
                                <linearGradient id="bg2" x1="70" y1="10" x2="10" y2="70" gradientUnits="userSpaceOnUse">
                                    <stop offset="0%" stopColor="#818cf8" />
                                    <stop offset="100%" stopColor="#4f46e5" />
                                </linearGradient>
                                <linearGradient id="hl" x1="20" y1="10" x2="60" y2="60" gradientUnits="userSpaceOnUse">
                                    <stop offset="0%" stopColor="#c7d2fe" stopOpacity="0.9" />
                                    <stop offset="100%" stopColor="#818cf8" stopOpacity="0.3" />
                                </linearGradient>
                            </defs>
                            {/* == 左脑三角面 (填充) == */}
                            <polygon points="25,10 15,18 20,28" fill="url(#hl)" opacity="0.5" />
                            <polygon points="25,10 20,28 32,22" fill="url(#bg)" opacity="0.35" />
                            <polygon points="15,18 10,30 20,28" fill="url(#bg)" opacity="0.25" />
                            <polygon points="10,30 12,42 20,28" fill="url(#bg2)" opacity="0.3" />
                            <polygon points="20,28 12,42 22,40" fill="url(#hl)" opacity="0.2" />
                            <polygon points="20,28 22,40 32,34" fill="url(#bg)" opacity="0.4" />
                            <polygon points="20,28 32,34 32,22" fill="url(#hl)" opacity="0.35" />
                            <polygon points="12,42 18,52 22,40" fill="url(#bg)" opacity="0.3" />
                            <polygon points="22,40 18,52 28,54" fill="url(#bg2)" opacity="0.25" />
                            <polygon points="22,40 28,54 32,46" fill="url(#hl)" opacity="0.2" />
                            <polygon points="22,40 32,46 32,34" fill="url(#bg)" opacity="0.35" />
                            <polygon points="28,54 32,60 32,46" fill="url(#bg2)" opacity="0.3" />
                            {/* == 右脑三角面 (填充) == */}
                            <polygon points="55,10 60,18 48,22" fill="url(#bg2)" opacity="0.3" />
                            <polygon points="55,10 48,22 40,16" fill="url(#hl)" opacity="0.45" />
                            <polygon points="60,18 68,30 58,28" fill="url(#bg)" opacity="0.25" />
                            <polygon points="60,18 58,28 48,22" fill="url(#bg2)" opacity="0.35" />
                            <polygon points="68,30 66,42 58,28" fill="url(#bg)" opacity="0.3" />
                            <polygon points="58,28 66,42 56,40" fill="url(#hl)" opacity="0.2" />
                            <polygon points="58,28 56,40 48,34" fill="url(#bg2)" opacity="0.4" />
                            <polygon points="58,28 48,34 48,22" fill="url(#bg)" opacity="0.3" />
                            <polygon points="66,42 60,52 56,40" fill="url(#bg2)" opacity="0.3" />
                            <polygon points="56,40 60,52 50,54" fill="url(#bg)" opacity="0.25" />
                            <polygon points="56,40 50,54 48,46" fill="url(#hl)" opacity="0.2" />
                            <polygon points="56,40 48,46 48,34" fill="url(#bg2)" opacity="0.35" />
                            <polygon points="50,54 48,60 48,46" fill="url(#bg)" opacity="0.3" />
                            {/* == 中央连接面 == */}
                            <polygon points="32,22 40,16 48,22" fill="url(#hl)" opacity="0.5" />
                            <polygon points="32,22 48,22 40,28" fill="url(#bg)" opacity="0.3" />
                            <polygon points="32,34 40,28 48,34" fill="url(#hl)" opacity="0.25" />
                            <polygon points="32,46 40,42 48,46" fill="url(#bg2)" opacity="0.2" />
                            <polygon points="32,34 40,42 48,34" fill="url(#bg)" opacity="0.15" />
                            <polygon points="32,34 32,46 40,42" fill="url(#hl)" opacity="0.1" />
                            <polygon points="48,34 48,46 40,42" fill="url(#bg2)" opacity="0.1" />
                            <polygon points="32,60 40,64 48,60" fill="url(#bg)" opacity="0.25" />
                            <polygon points="32,46 40,42 32,34" fill="url(#hl)" opacity="0.08" />
                            {/* == 所有三角网格线 == */}
                            <g stroke="url(#bg2)" strokeWidth="0.7" fill="none" opacity="0.7">
                                {/* 左脑轮廓 */}
                                <polygon points="25,10 15,18 10,30 12,42 18,52 28,54 32,60 32,46 32,34 32,22" />
                                {/* 左脑内部线 */}
                                <line x1="25" y1="10" x2="20" y2="28" />
                                <line x1="25" y1="10" x2="32" y2="22" />
                                <line x1="15" y1="18" x2="20" y2="28" />
                                <line x1="10" y1="30" x2="20" y2="28" />
                                <line x1="10" y1="30" x2="22" y2="40" />
                                <line x1="12" y1="42" x2="22" y2="40" />
                                <line x1="20" y1="28" x2="22" y2="40" />
                                <line x1="20" y1="28" x2="32" y2="34" />
                                <line x1="22" y1="40" x2="32" y2="34" />
                                <line x1="22" y1="40" x2="32" y2="46" />
                                <line x1="18" y1="52" x2="22" y2="40" />
                                <line x1="18" y1="52" x2="28" y2="54" />
                                <line x1="28" y1="54" x2="32" y2="46" />
                                <line x1="28" y1="54" x2="32" y2="60" />
                            </g>
                            <g stroke="url(#bg2)" strokeWidth="0.7" fill="none" opacity="0.7">
                                {/* 右脑轮廓 */}
                                <polygon points="55,10 60,18 68,30 66,42 60,52 50,54 48,60 48,46 48,34 48,22" />
                                {/* 右脑内部线 */}
                                <line x1="55" y1="10" x2="58" y2="28" />
                                <line x1="55" y1="10" x2="48" y2="22" />
                                <line x1="60" y1="18" x2="58" y2="28" />
                                <line x1="68" y1="30" x2="58" y2="28" />
                                <line x1="68" y1="30" x2="56" y2="40" />
                                <line x1="66" y1="42" x2="56" y2="40" />
                                <line x1="58" y1="28" x2="56" y2="40" />
                                <line x1="58" y1="28" x2="48" y2="34" />
                                <line x1="56" y1="40" x2="48" y2="34" />
                                <line x1="56" y1="40" x2="48" y2="46" />
                                <line x1="60" y1="52" x2="56" y2="40" />
                                <line x1="60" y1="52" x2="50" y2="54" />
                                <line x1="50" y1="54" x2="48" y2="46" />
                                <line x1="50" y1="54" x2="48" y2="60" />
                            </g>
                            {/* 中央连接线 */}
                            <g stroke="url(#hl)" strokeWidth="0.8" fill="none" opacity="0.6">
                                <line x1="32" y1="22" x2="48" y2="22" />
                                <line x1="32" y1="22" x2="40" y2="16" />
                                <line x1="48" y1="22" x2="40" y2="16" />
                                <line x1="32" y1="22" x2="40" y2="28" />
                                <line x1="48" y1="22" x2="40" y2="28" />
                                <line x1="32" y1="34" x2="48" y2="34" />
                                <line x1="32" y1="34" x2="40" y2="28" />
                                <line x1="48" y1="34" x2="40" y2="28" />
                                <line x1="32" y1="34" x2="40" y2="42" />
                                <line x1="48" y1="34" x2="40" y2="42" />
                                <line x1="32" y1="46" x2="48" y2="46" />
                                <line x1="32" y1="46" x2="40" y2="42" />
                                <line x1="48" y1="46" x2="40" y2="42" />
                                <line x1="32" y1="60" x2="48" y2="60" />
                                <line x1="32" y1="60" x2="40" y2="64" />
                                <line x1="48" y1="60" x2="40" y2="64" />
                            </g>
                            {/* 顶部连接 */}
                            <line x1="25" y1="10" x2="40" y2="6" stroke="url(#bg2)" strokeWidth="0.6" opacity="0.5" />
                            <line x1="55" y1="10" x2="40" y2="6" stroke="url(#bg2)" strokeWidth="0.6" opacity="0.5" />
                            <line x1="40" y1="6" x2="40" y2="16" stroke="url(#bg2)" strokeWidth="0.6" opacity="0.4" />
                            <circle cx="40" cy="6" r="1.5" fill="url(#bg2)" opacity="0.5" />
                        </svg>
                        <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1e293b' }}>
                            CoThink AI
                        </h1>
                        <p className="text-sm mt-1.5 tracking-wide" style={{ color: '#94a3b8' }}>
                            协作学习，共同思考
                        </p>
                    </div>

                    {/* 表单 */}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* 姓名 (仅注册) */}
                        {!isLogin && (
                            <div className="relative">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px]"
                                    style={{ color: '#cbd5e1' }} />
                                <input
                                    type="text"
                                    placeholder="您的姓名"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full pl-12 pr-4 py-3.5 rounded-xl text-sm outline-none transition-all duration-200"
                                    style={{ background: 'rgba(248,250,252,0.8)', border: '1.5px solid #e2e8f0', color: '#1e293b' }}
                                    onFocus={(e) => { e.currentTarget.style.borderColor = '#818cf8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.1)'; }}
                                    onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
                                    required={!isLogin}
                                />
                            </div>
                        )}

                        {/* 邮箱 */}
                        <div className="relative">
                            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px]"
                                style={{ color: '#cbd5e1' }} />
                            <input
                                id="login-email"
                                type="email"
                                placeholder="邮箱地址"
                                value={formData.email}
                                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                className="w-full pl-12 pr-4 py-3.5 rounded-xl text-sm outline-none transition-all duration-200"
                                style={{ background: 'rgba(248,250,252,0.8)', border: '1.5px solid #e2e8f0', color: '#1e293b' }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#818cf8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.1)'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
                                required
                                autoComplete="email"
                            />
                        </div>

                        {/* 密码 */}
                        <div className="relative">
                            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px]"
                                style={{ color: '#cbd5e1' }} />
                            <input
                                id="login-password"
                                type="password"
                                placeholder="密码"
                                value={formData.password}
                                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                className="w-full pl-12 pr-4 py-3.5 rounded-xl text-sm outline-none transition-all duration-200"
                                style={{ background: 'rgba(248,250,252,0.8)', border: '1.5px solid #e2e8f0', color: '#1e293b' }}
                                onFocus={(e) => { e.currentTarget.style.borderColor = '#818cf8'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.1)'; }}
                                onBlur={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
                                required
                                minLength={6}
                                autoComplete="current-password"
                            />
                        </div>

                        {/* 记住我（仅登录时显示） */}
                        {isLogin && (
                            <label className="flex items-center gap-2 cursor-pointer select-none" htmlFor="remember-me">
                                <input
                                    id="remember-me"
                                    type="checkbox"
                                    checked={rememberMe}
                                    onChange={(e) => setRememberMe(e.target.checked)}
                                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                                />
                                <span className="text-xs" style={{ color: '#64748b' }}>记住我</span>
                            </label>
                        )}

                        {/* 角色选择 (仅注册) */}
                        {!isLogin && (
                            <div className="grid grid-cols-2 gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, role: 'student' })}
                                    className={clsx(
                                        'py-2.5 rounded-xl border text-sm font-medium transition-all',
                                        formData.role === 'student'
                                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                            : 'bg-white/60 border-gray-200 text-gray-500 hover:bg-gray-50'
                                    )}
                                >
                                    🎓 学生
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setFormData({ ...formData, role: 'teacher' })}
                                    className={clsx(
                                        'py-2.5 rounded-xl border text-sm font-medium transition-all',
                                        formData.role === 'teacher'
                                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                                            : 'bg-white/60 border-gray-200 text-gray-500 hover:bg-gray-50'
                                    )}
                                >
                                    👩‍🏫 教师
                                </button>
                            </div>
                        )}

                        {/* 错误提示 */}
                        {error && (
                            <div className="px-4 py-3 rounded-xl text-xs flex items-center gap-2"
                                style={{ background: 'rgba(254,226,226,0.6)', border: '1px solid rgba(252,165,165,0.4)', color: '#dc2626' }}>
                                <span>⚠️</span>{error}
                            </div>
                        )}

                        {/* 登录/注册按钮 */}
                        <button
                            id="login-submit"
                            type="submit"
                            disabled={loading}
                            className="w-full py-3.5 mt-2 text-white font-semibold rounded-xl text-sm transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                                boxShadow: loading ? 'none' : '0 4px 16px rgba(79,70,229,0.2)',
                            }}
                            onMouseEnter={(e) => {
                                if (!loading) {
                                    e.currentTarget.style.boxShadow = '0 6px 24px rgba(79,70,229,0.35)';
                                    e.currentTarget.style.transform = 'translateY(-1px)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.boxShadow = '0 4px 16px rgba(79,70,229,0.2)';
                                e.currentTarget.style.transform = 'translateY(0)';
                            }}
                        >
                            {loading ? (
                                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />处理中...</>
                            ) : (
                                <>{isLogin ? '登 录' : '创建账号'}</>
                            )}
                        </button>
                    </form>

                    {/* 切换登录/注册 */}
                    <div className="mt-7 text-center">
                        {REGISTRATION_OPEN ? (
                            <>
                                <span className="text-xs" style={{ color: '#94a3b8' }}>
                                    {isLogin ? '还没有账号？' : '已有账号？'}
                                </span>
                                <button
                                    onClick={() => { setIsLogin(!isLogin); setError(null); }}
                                    className="ml-1 text-xs font-semibold transition-colors"
                                    style={{ color: '#4f46e5' }}
                                >
                                    {isLogin ? '立即注册' : '去登录'}
                                </button>
                            </>
                        ) : (
                            <button
                                onClick={() => alert('现在先去完成任务书啦！不要创号！')}
                                className="text-xs transition-colors"
                                style={{ color: '#94a3b8' }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#64748b'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = '#94a3b8'; }}
                            >
                                还没有账号？联系老师开通
                            </button>
                        )}
                    </div>
                </div>

                <p className="mt-6 text-center text-[11px]" style={{ color: '#cbd5e1' }}>
                    © 2026 CoThink AI · 协作学习平台
                </p>
            </div>
        </div>
    );
};
