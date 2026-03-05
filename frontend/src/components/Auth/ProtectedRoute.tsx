/**
 * 路由守卫 — 未登录重定向到 /login，角色不匹配重定向到对应页面。
 */
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';

interface ProtectedRouteProps {
    children: React.ReactNode;
    requiredRole?: 'student' | 'teacher';
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
    const { isAuthenticated, user } = useAuthStore();

    if (!isAuthenticated) {
        return <Navigate to="/login" replace />;
    }

    // 角色守卫：教师访问学生页面 → 重定向到教师端，反之亦然
    if (requiredRole && user?.role !== requiredRole) {
        return <Navigate to={user?.role === 'teacher' ? '/teacher' : '/student'} replace />;
    }

    return <>{children}</>;
}
