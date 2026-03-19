/**
 * 认证 Store — 登录、注册、登出、token 管理。
 * P0 修复：从 sessionStorage 迁移到 localStorage，支持关闭标签页后保持登录。
 * 新增 Token 自动续期：距过期 < 30 分钟时自动请求 /auth/refresh。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types';
import { api } from '../api';

// Token 续期定时器
let _refreshTimer: ReturnType<typeof setInterval> | null = null;
const REFRESH_CHECK_INTERVAL = 5 * 60 * 1000; // 每 5 分钟检查一次
const REFRESH_THRESHOLD = 30 * 60; // 距过期 30 分钟时续期

/** 解析 JWT payload（不验证签名，仅解码）。 */
function parseJwtExp(token: string): number | null {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp || null;
    } catch {
        return null;
    }
}

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;
    rememberMe: boolean;

    login: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
    register: (email: string, password: string, name: string, role: string) => Promise<void>;
    logout: () => void;
    setAuth: (user: User, token: string) => void;
    startTokenRefresh: () => void;
    stopTokenRefresh: () => void;
}

/** 根据 rememberMe 获取对应的 storage */
function getTokenStorage(rememberMe: boolean): Storage {
    return rememberMe ? localStorage : sessionStorage;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, get) => ({
            user: null,
            token: null,
            isAuthenticated: false,
            rememberMe: true,  // 默认记住我

            login: async (email, password, rememberMe = true) => {
                // 登录前清空所有旧用户状态，防止跨用户数据泄漏
                const { useChatStore } = await import('./useChatStore');
                const { useGroupStore } = await import('./useGroupStore');
                const { useAiConversationStore } = await import('./useAiConversationStore');
                useChatStore.getState().clearMessages();
                useGroupStore.getState().clearGroups();
                useAiConversationStore.getState().clearAll();

                const data = await api.auth.login(email, password);
                const storage = getTokenStorage(rememberMe);
                storage.setItem('cothink-token', data.access_token);
                set({
                    user: data.user,
                    token: data.access_token,
                    isAuthenticated: true,
                    rememberMe,
                });
                // 启动自动续期
                get().startTokenRefresh();
            },

            register: async (email, password, name, role) => {
                const data = await api.auth.register(email, password, name, role);
                const rememberMe = get().rememberMe;
                const storage = getTokenStorage(rememberMe);
                storage.setItem('cothink-token', data.access_token);
                set({
                    user: data.user,
                    token: data.access_token,
                    isAuthenticated: true,
                });
                get().startTokenRefresh();
            },

            logout: () => {
                get().stopTokenRefresh();
                // 清除两种 storage 中的 token
                localStorage.removeItem('cothink-token');
                sessionStorage.removeItem('cothink-token');
                // 清空所有用户相关状态
                import('./useChatStore').then(m => m.useChatStore.getState().clearMessages());
                import('./useGroupStore').then(m => m.useGroupStore.getState().clearGroups());
                import('./useAiConversationStore').then(m => m.useAiConversationStore.getState().clearAll());
                set({
                    user: null,
                    token: null,
                    isAuthenticated: false,
                    rememberMe: true,
                });
            },

            setAuth: (user, token) => {
                const storage = getTokenStorage(get().rememberMe);
                storage.setItem('cothink-token', token);
                set({ user, token, isAuthenticated: true });
                get().startTokenRefresh();
            },

            startTokenRefresh: () => {
                // 先停止旧的定时器
                get().stopTokenRefresh();
                _refreshTimer = setInterval(async () => {
                    const currentToken = get().token;
                    if (!currentToken) return;

                    const exp = parseJwtExp(currentToken);
                    if (!exp) return;

                    const now = Math.floor(Date.now() / 1000);
                    const remaining = exp - now;

                    if (remaining > 0 && remaining < REFRESH_THRESHOLD) {
                        try {
                            const data = await api.auth.refresh();
                            const storage = getTokenStorage(get().rememberMe);
                            storage.setItem('cothink-token', data.access_token);
                            set({ token: data.access_token });
                            console.log('[Auth] Token refreshed successfully');
                        } catch (e) {
                            console.warn('[Auth] Token refresh failed:', e);
                        }
                    }
                }, REFRESH_CHECK_INTERVAL);
            },

            stopTokenRefresh: () => {
                if (_refreshTimer) {
                    clearInterval(_refreshTimer);
                    _refreshTimer = null;
                }
            },
        }),
        {
            name: 'cothink-auth',
            // P0 修复：使用 localStorage 替代 sessionStorage
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                user: state.user,
                token: state.token,
                isAuthenticated: state.isAuthenticated,
                rememberMe: state.rememberMe,
            }),
        }
    )
);

// 从 localStorage 恢复后，自动启动 token 续期 + sessionStorage 迁移
const restoredState = useAuthStore.getState();
if (restoredState.isAuthenticated && restoredState.token) {
    // 迁移：若 sessionStorage 中有旧 token，同步到 localStorage
    const oldToken = sessionStorage.getItem('cothink-token');
    if (oldToken) {
        localStorage.setItem('cothink-token', oldToken);
        sessionStorage.removeItem('cothink-token');
        sessionStorage.removeItem('cothink-auth');
    }
    restoredState.startTokenRefresh();
}
