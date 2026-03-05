/**
 * App 根组件 — React Router v6 路由配置。
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { LoginPage } from './components/Auth/LoginPage';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';
import { StudentView } from './components/StudentView/StudentView';
import { TeacherDashboard } from './components/TeacherView/TeacherDashboard';

function AppRoutes() {
    const { isAuthenticated, user } = useAuthStore();

    return (
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
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <AppRoutes />
        </BrowserRouter>
    );
}
