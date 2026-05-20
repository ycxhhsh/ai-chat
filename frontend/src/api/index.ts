/**
 * API 层 — 统一 axios 实例 + 认证拦截器。
 *
 * P0-4: 仅 401 时 logout，其他错误不退出登录。
 */
import axios from 'axios';
import type {
    Assignment,
    AssignmentTask,
    AssignmentTaskDetail,
    AssignmentTaskListItem,
    Group,
    LLMProvider,
    LearningSpaceQuestion,
    LearningSpaceSessionPayload,
    LearningSpaceStudentQuestionItem,
    Scaffold,
    TeacherAssignmentTaskDetail,
} from '../types';

const http = axios.create({
    baseURL: window.location.origin,
});

// P0 修复：token 存储根据"记住我"选项使用 localStorage 或 sessionStorage
http.interceptors.request.use((config) => {
    const token = localStorage.getItem('cothink-token') || sessionStorage.getItem('cothink-token');
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
            localStorage.removeItem('cothink-token');
            localStorage.removeItem('cothink-auth');
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
        refresh: async () => {
            const res = await http.post('/auth/refresh');
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
        rename: async (groupId: string, name: string) => {
            const res = await http.patch(`/groups/${groupId}`, { name });
            return res.data;
        },
        members: async (groupId: string) => {
            const res = await http.get(`/groups/${groupId}/members`);
            return res.data as { user_id: string; name: string; role: string }[];
        },
        pushStage: (groupId: string, stage: string) =>
            http.post(`/groups/${groupId}/stage`, { stage }).then(r => r.data),
        pushStageToAll: (stage: string) =>
            http.post('/groups/stage/all', { stage }).then(r => r.data),
    },

    scaffolds: {
        list: async () => {
            const res = await http.get('/scaffolds');
            return res.data as Scaffold[];
        },
    },

    learningSpaceDesign: {
        meta: async () => {
            const res = await http.get('/learning-space-design/meta');
            return res.data as { stages: string[]; steps: string[] };
        },
        teacherQuestions: async () => {
            const res = await http.get('/learning-space-design/questions');
            return res.data as LearningSpaceQuestion[];
        },
        createQuestion: async (data: Record<string, unknown>) => {
            const res = await http.post('/learning-space-design/questions', data);
            return res.data as LearningSpaceQuestion;
        },
        updateQuestion: async (questionId: string, data: Record<string, unknown>) => {
            const res = await http.put(`/learning-space-design/questions/${questionId}`, data);
            return res.data as LearningSpaceQuestion;
        },
        deleteQuestion: async (questionId: string) => {
            const res = await http.delete(`/learning-space-design/questions/${questionId}`);
            return res.data;
        },
        progress: async () => {
            const res = await http.get('/learning-space-design/progress');
            return res.data as Array<Record<string, unknown>>;
        },
        studentQuestions: async () => {
            const res = await http.get('/learning-space-design/student/questions');
            return res.data as LearningSpaceStudentQuestionItem[];
        },
        startSession: async (questionId: string, groupId?: string | null) => {
            const res = await http.post(`/learning-space-design/questions/${questionId}/start`, {
                group_id: groupId || null,
            });
            return res.data;
        },
        getSession: async (sessionId: string) => {
            const res = await http.get(`/learning-space-design/sessions/${sessionId}`);
            return res.data as LearningSpaceSessionPayload;
        },
        createEntry: async (sessionId: string, stepKey: string, content: string) => {
            const res = await http.post(`/learning-space-design/sessions/${sessionId}/entries`, {
                step_key: stepKey,
                content,
            });
            return res.data;
        },
        updateEntry: async (sessionId: string, entryId: string, content: string) => {
            const res = await http.put(`/learning-space-design/sessions/${sessionId}/entries/${entryId}`, {
                content,
            });
            return res.data;
        },
        sendAiMessage: async (sessionId: string, stepKey: string, content: string, llmProvider?: string) => {
            const res = await http.post(`/learning-space-design/sessions/${sessionId}/ai-message`, {
                step_key: stepKey,
                content,
                llm_provider: llmProvider || 'deepseek',
            });
            return res.data;
        },
        submitStep: async (sessionId: string, stepKey: string) => {
            const res = await http.post(`/learning-space-design/sessions/${sessionId}/submit-step`, {
                step_key: stepKey,
            });
            return res.data;
        },
        checkAcceleration: async (sessionId: string, stepKey: string, content: string, llmProvider?: string) => {
            const res = await http.post(`/learning-space-design/sessions/${sessionId}/check-acceleration`, {
                step_key: stepKey,
                content,
                llm_provider: llmProvider || 'deepseek',
            });
            return res.data;
        },
        adoptAcceleration: async (sessionId: string, checkId: string) => {
            const res = await http.post(`/learning-space-design/sessions/${sessionId}/adopt-acceleration`, {
                check_id: checkId,
            });
            return res.data;
        },
        generateSummary: async (sessionId: string, llmProvider?: string) => {
            const res = await http.post(`/learning-space-design/sessions/${sessionId}/generate-summary`, {
                llm_provider: llmProvider || 'deepseek',
            });
            return res.data;
        },
        report: async (sessionId: string) => {
            const res = await http.get(`/learning-space-design/sessions/${sessionId}/report`);
            return res.data;
        },
        exportReport: async (sessionId: string) => {
            const res = await http.get(`/learning-space-design/sessions/${sessionId}/export`);
            return res.data;
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
        tasks: async () => {
            const res = await http.get('/assignments/tasks');
            return res.data as AssignmentTaskListItem[];
        },
        taskDetail: async (taskId: string) => {
            const res = await http.get(`/assignments/tasks/${taskId}`);
            return res.data as AssignmentTaskDetail;
        },
        submitToTask: async (taskId: string, content: string, fileUrl?: string | null) => {
            const res = await http.post(`/assignments/tasks/${taskId}/submit`, {
                content,
                file_url: fileUrl || null,
            });
            return res.data as AssignmentTaskDetail;
        },
        submitSelfReview: async (taskId: string, score: number, comment: string | null) => {
            const res = await http.post(`/assignments/tasks/${taskId}/self-review`, {
                score,
                comment,
            });
            return res.data;
        },
        submitPeerReview: async (reviewId: string, score: number, comment: string | null) => {
            const res = await http.patch(`/assignments/peer-reviews/${reviewId}`, {
                score,
                comment,
            });
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

    // P3: Jobs & Notifications
    jobs: {
        create: async (data: { type: string; title: string; input_data?: Record<string, unknown>; llm_provider?: string; session_id?: string }) => {
            const res = await http.post('/jobs', data);
            return res.data;
        },
        list: async () => {
            const res = await http.get('/jobs');
            return res.data;
        },
        get: async (jobId: string) => {
            const res = await http.get(`/jobs/${jobId}`);
            return res.data;
        },
    },

    notifications: {
        list: async () => {
            const res = await http.get('/notifications');
            return res.data;
        },
        unreadCount: async () => {
            const res = await http.get('/notifications/unread-count');
            return res.data;
        },
        markRead: async (id: string) => {
            const res = await http.patch(`/notifications/${id}/read`);
            return res.data;
        },
        markAllRead: async () => {
            const res = await http.patch('/notifications/read-all');
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
        bloomAnalysis: async () => {
            const res = await http.post('/teacher/analytics/bloom');
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
        assignmentTasks: async () => {
            const res = await http.get('/teacher/assignment-tasks');
            return res.data as AssignmentTask[];
        },
        createAssignmentTask: async (data: {
            title: string;
            description?: string | null;
            target_student_ids: string[];
            peer_review_count?: number;
        }) => {
            const res = await http.post('/teacher/assignment-tasks', data);
            return res.data as AssignmentTask;
        },
        assignmentTaskDetail: async (taskId: string) => {
            const res = await http.get(`/teacher/assignment-tasks/${taskId}`);
            return res.data as TeacherAssignmentTaskDetail;
        },
        startAssignmentPeerReview: async (taskId: string) => {
            const res = await http.post(`/teacher/assignment-tasks/${taskId}/start-peer-review`);
            return res.data as AssignmentTask;
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
        groups: async () => {
            const res = await http.get('/teacher/groups');
            return res.data;
        },
        removeGroupMember: async (groupId: string, userId: string) => {
            const res = await http.delete(`/teacher/groups/${groupId}/members/${userId}`);
            return res.data;
        },
        transferGroupMember: async (groupId: string, userId: string, targetGroupId: string) => {
            const res = await http.post(`/teacher/groups/${groupId}/members/${userId}/transfer`, { target_group_id: targetGroupId });
            return res.data;
        },
        renameGroup: async (groupId: string, name: string) => {
            const res = await http.patch(`/teacher/groups/${groupId}`, { name });
            return res.data;
        },
        deleteGroup: async (groupId: string) => {
            const res = await http.delete(`/teacher/groups/${groupId}`);
            return res.data;
        },
        getScaffoldSuggestEnabled: async (): Promise<{ enabled: boolean }> => {
            const res = await http.get('/teacher/settings/scaffold-suggest');
            return res.data;
        },
        setScaffoldSuggestEnabled: async (enabled: boolean) => {
            const res = await http.put('/teacher/settings/scaffold-suggest', { enabled });
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
        list: async (groupId?: string) => {
            const params: Record<string, string> = {};
            if (groupId) params.group_id = groupId;
            const res = await http.get('/ai-conversations', { params });
            return res.data;
        },
        create: async (llmProvider?: string, groupId?: string) => {
            const res = await http.post('/ai-conversations', {
                title: '新对话',
                llm_provider: llmProvider || null,
                group_id: groupId || null,
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
        summarize: async (conversationId: string) => {
            const res = await http.post(`/ai-conversations/${conversationId}/summarize`);
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
        addOne: async (name: string, studentId: string) => {
            const res = await http.post('/roster/add-one', { name, student_id: studentId });
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
