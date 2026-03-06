/**
 * API 层 — 统一 axios 实例 + 认证拦截器。
 *
 * P0-4: 仅 401 时 logout，其他错误不退出登录。
 */
import axios from 'axios';
import type { Assignment, Group, LLMProvider, Scaffold } from '../types';

const http = axios.create({
    baseURL: window.location.origin,
});

// 请求拦截器：自动附带 token
http.interceptors.request.use((config) => {
    const token = sessionStorage.getItem('cothink-token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// P0-4: 响应拦截器 — 区分 401 认证过期 vs 其他错误
http.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            console.warn('[API] 401 Unauthorized — clearing auth and redirecting');
            sessionStorage.removeItem('cothink-token');
            sessionStorage.removeItem('cothink-auth');
            if (!window.location.pathname.includes('/login')) {
                window.location.href = '/login';
            }
        } else {
            console.error(
                `[API] Request failed: ${error.response?.status} ${error.config?.method?.toUpperCase()} ${error.config?.url}`,
                error.response?.data || error.message,
            );
        }
        return Promise.reject(error);
    },
);

export const api = {
    auth: {
        register: async (email: string, password: string, name: string, role: string) => {
            const res = await http.post('/auth/register', { email, password, name, role });
            return res.data;
        },
        login: async (email: string, password: string) => {
            const res = await http.post('/auth/login', { email, password });
            return res.data;
        },
        changePassword: async (oldPassword: string, newPassword: string) => {
            const res = await http.put('/auth/password', { old_password: oldPassword, new_password: newPassword });
            return res.data;
        },
        me: async () => {
            const res = await http.get('/auth/me');
            return res.data;
        },
    },

    groups: {
        list: async () => {
            const res = await http.get('/groups/my');
            return res.data as Group[];
        },
        create: async (name: string) => {
            const res = await http.post('/groups', { name });
            return res.data as Group;
        },
        join: async (inviteCode: string) => {
            const res = await http.post('/groups/join', { invite_code: inviteCode });
            return res.data;
        },
        delete: async (groupId: string) => {
            const res = await http.delete(`/groups/${groupId}`);
            return res.data;
        },
    },

    scaffolds: {
        list: async () => {
            const res = await http.get('/scaffolds');
            return res.data as Scaffold[];
        },
    },

    mindmaps: {
        get: async (mapKey: string) => {
            const res = await http.get(`/mindmaps/${mapKey}`);
            return res.data;
        },
    },

    assignments: {
        submit: async (content: string, fileUrl?: string) => {
            const res = await http.post('/assignments', { content, file_url: fileUrl || null });
            return res.data;
        },
        mine: async () => {
            const res = await http.get('/assignments/mine');
            return res.data as Assignment[];
        },
        list: async (sessionId: string) => {
            const res = await http.get(`/assignments/by-session/${sessionId}`);
            return res.data as Assignment[];
        },
        grade: async (assignmentId: string) => {
            const res = await http.post(`/assignments/${assignmentId}/grade`);
            return res.data;
        },
        review: async (assignmentId: string, score: number | null, comment: string | null) => {
            const res = await http.patch(`/assignments/${assignmentId}/review`, { score, comment });
            return res.data;
        },
    },

    teacher: {
        stats: async () => {
            const res = await http.get('/teacher/stats');
            return res.data;
        },
        students: async (page = 1, pageSize = 15) => {
            const res = await http.get('/teacher/students', { params: { page, page_size: pageSize } });
            return res.data;
        },
        messages: async (params: Record<string, unknown> = {}) => {
            const res = await http.get('/teacher/messages', { params });
            return res.data;
        },
        analytics: async () => {
            const res = await http.get('/teacher/analytics');
            return res.data;
        },
        exportCsv: async (sessionId?: string) => {
            const params: Record<string, string> = {};
            if (sessionId) params.session_id = sessionId;
            const res = await http.get('/teacher/export/messages', {
                params,
                responseType: 'blob',
            });
            return res.data;
        },
        assignments: async () => {
            const res = await http.get('/teacher/assignments');
            return res.data;
        },
        aiConversations: async (params: Record<string, unknown> = {}) => {
            const res = await http.get('/teacher/ai-conversations', { params });
            return res.data;
        },
        aiConversationMessages: async (conversationId: string) => {
            const res = await http.get(`/teacher/ai-conversations/${conversationId}/messages`);
            return res.data;
        },
        exportAiConversationsCsv: async () => {
            const res = await http.get('/teacher/ai-conversations/export', {
                responseType: 'blob',
            });
            return res.data;
        },
        unifiedMessages: async (params: Record<string, unknown> = {}) => {
            const res = await http.get('/teacher/unified-messages', { params });
            return res.data;
        },
        exportUnifiedCsv: async () => {
            const res = await http.get('/teacher/export/unified', {
                responseType: 'blob',
            });
            return res.data;
        },
    },

    knowledge: {
        upload: async (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            const res = await http.post('/knowledge/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return res.data;
        },
        list: async () => {
            const res = await http.get('/knowledge/documents');
            return res.data;
        },
        delete: async (sourceFile: string) => {
            const res = await http.delete(`/knowledge/documents/${encodeURIComponent(sourceFile)}`);
            return res.data;
        },
    },

    messages: {
        getSession: async (sessionId: string) => {
            const res = await http.get(`/messages/session/${sessionId}`);
            return res.data;
        },
    },

    aiConversations: {
        list: async () => {
            const res = await http.get('/ai-conversations');
            return res.data;
        },
        create: async (llmProvider?: string) => {
            const res = await http.post('/ai-conversations', {
                title: '新对话',
                llm_provider: llmProvider || null,
            });
            return res.data;
        },
        getMessages: async (conversationId: string) => {
            const res = await http.get(`/ai-conversations/${conversationId}/messages`);
            return res.data;
        },
        delete: async (conversationId: string) => {
            const res = await http.delete(`/ai-conversations/${conversationId}`);
            return res.data;
        },
        rename: async (conversationId: string, title: string) => {
            const res = await http.patch(`/ai-conversations/${conversationId}`, { title });
            return res.data;
        },
    },

    llm: {
        providers: async () => {
            const res = await http.get('/llm/providers');
            return res.data as LLMProvider[];
        },
    },

    upload: {
        file: async (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            const res = await http.post('/upload/', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return res.data;
        },
    },

    roster: {
        import: async (file: File) => {
            const formData = new FormData();
            formData.append('file', file);
            const res = await http.post('/roster/import', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            return res.data;
        },
    },

    courses: {
        list: async () => {
            const res = await http.get('/courses');
            return res.data;
        },
        create: async (name: string, description = '') => {
            const res = await http.post('/courses', { name, description });
            return res.data;
        },
        join: async (inviteCode: string) => {
            const res = await http.post('/courses/join', { invite_code: inviteCode });
            return res.data;
        },
        students: async (courseId: string) => {
            const res = await http.get(`/courses/${courseId}/students`);
            return res.data;
        },
    },
};

export default http;
