/**
 * App 根组件 — React Router v6 路由配置。
 */
import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';

const LoginPage = lazy(() => import('./components/Auth/LoginPage').then(mod => ({ default: mod.LoginPage })));
const StudentView = lazy(() => import('./components/StudentView/StudentView').then(mod => ({ default: mod.StudentView })));
const TeacherDashboard = lazy(() => import('./components/TeacherView/TeacherDashboard').then(mod => ({ default: mod.TeacherDashboard })));

function PageFallback() {
    return (
        <div className="h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">
            加载中...
        </div>
    );
}

/** 检查 JWT 是否已过期 */
function isTokenExpired(token: string): boolean {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp ? payload.exp * 1000 < Date.now() : false;
    } catch {
        return true; // 解析失败视为过期
    }
}

function AppRoutes() {
    const { isAuthenticated, user, token, logout } = useAuthStore();

    // 启动时校验 token 有效性
    useEffect(() => {
        if (isAuthenticated && token && isTokenExpired(token)) {
            console.log('[Auth] Token expired, logging out');
            logout();
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Suspense fallback={<PageFallback />}>
            <Routes>
                {/* 登录页 */}
                <Route
                    path="/login"
                    element={
                        isAuthenticated
                            ? <Navigate to={user?.role === 'teacher' ? '/teacher' : '/student'} replace />
                            : <LoginPage />
                    }
                />

                {/* 学生端 */}
                <Route
                    path="/student/*"
                    element={
                        <ProtectedRoute requiredRole="student">
                            <StudentView />
                        </ProtectedRoute>
                    }
                />

                {/* 教师端 */}
                <Route
                    path="/teacher/*"
                    element={
                        <ProtectedRoute requiredRole="teacher">
                            <TeacherDashboard />
                        </ProtectedRoute>
                    }
                />

                {/* 根路径：按角色重定向 */}
                <Route
                    path="*"
                    element={
                        isAuthenticated
                            ? <Navigate to={user?.role === 'teacher' ? '/teacher' : '/student'} replace />
                            : <Navigate to="/login" replace />
                    }
                />
            </Routes>
        </Suspense>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AppRoutes />
        </BrowserRouter>
    );
}
