/**
 * 认证 Store — 登录、注册、登出、token 管理。
 * Sprint 4: 持久化到 sessionStorage（防止共享电脑幽灵登录）。
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '../types';
import { api } from '../api';

interface AuthState {
    user: User | null;
    token: string | null;
    isAuthenticated: boolean;

    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string, name: string, role: string) => Promise<void>;
    logout: () => void;
    setAuth: (user: User, token: string) => void;
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            user: null,
            token: null,
            isAuthenticated: false,

            login: async (email, password) => {
                // 登录前清空所有旧用户状态，防止跨用户数据泄漏
                const { useChatStore } = await import('./useChatStore');
                const { useGroupStore } = await import('./useGroupStore');
                const { useAiConversationStore } = await import('./useAiConversationStore');
                useChatStore.getState().clearMessages();
                useGroupStore.getState().clearGroups();
                useAiConversationStore.getState().clearAll();

                const data = await api.auth.login(email, password);
                sessionStorage.setItem('cothink-token', data.access_token);
                set({
                    user: data.user,
                    token: data.access_token,
                    isAuthenticated: true,
                });
            },

            register: async (email, password, name, role) => {
                const data = await api.auth.register(email, password, name, role);
                sessionStorage.setItem('cothink-token', data.access_token);
                set({
                    user: data.user,
                    token: data.access_token,
                    isAuthenticated: true,
                });
            },

            logout: () => {
                sessionStorage.removeItem('cothink-token');
                // 清空所有用户相关状态
                import('./useChatStore').then(m => m.useChatStore.getState().clearMessages());
                import('./useGroupStore').then(m => m.useGroupStore.getState().clearGroups());
                import('./useAiConversationStore').then(m => m.useAiConversationStore.getState().clearAll());
                set({
                    user: null,
                    token: null,
                    isAuthenticated: false,
                });
            },

            setAuth: (user, token) => {
                sessionStorage.setItem('cothink-token', token);
                set({ user, token, isAuthenticated: true });
            },
        }),
        {
            name: 'cothink-auth',
            storage: createJSONStorage(() => sessionStorage),
            partialize: (state) => ({
                user: state.user,
                token: state.token,
                isAuthenticated: state.isAuthenticated,
            }),
        }
    )
);
