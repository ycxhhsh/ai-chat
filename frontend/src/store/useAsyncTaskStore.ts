import { create } from 'zustand';

export type AsyncTaskType = 'ai_chat' | 'drawing' | 'learning_space_ai';

export type AsyncTaskStatus = 'queued' | 'running' | 'streaming' | 'succeeded' | 'failed';

export interface AsyncTask {
    taskId: string;
    type: AsyncTaskType;
    title: string;
    status: AsyncTaskStatus;
    progressText?: string;
    errorMessage?: string;
    retryable: boolean;
    retryPayload?: unknown;
    source: 'websocket' | 'http';
    relatedId?: string;
    startedAt: string;
    updatedAt: string;
    finishedAt?: string;
}

type NewAsyncTask = Omit<AsyncTask, 'startedAt' | 'updatedAt' | 'finishedAt'> & {
    startedAt?: string;
    updatedAt?: string;
    finishedAt?: string;
};

interface AsyncTaskState {
    tasks: Record<string, AsyncTask>;
    startTask: (task: NewAsyncTask) => void;
    updateTask: (taskId: string, patch: Partial<Omit<AsyncTask, 'taskId' | 'startedAt'>>) => void;
    completeTask: (taskId: string) => void;
    failTask: (taskId: string, errorMessage: string) => void;
    replaceTaskId: (currentTaskId: string, nextTaskId: string) => void;
    dismissTask: (taskId: string) => void;
    getVisibleTasks: () => AsyncTask[];
    resetTasks: () => void;
}

function nowIso() {
    return new Date().toISOString();
}

function isVisibleTask(task: AsyncTask) {
    return task.status === 'queued'
        || task.status === 'running'
        || task.status === 'streaming'
        || task.status === 'failed';
}

export const useAsyncTaskStore = create<AsyncTaskState>()((set, get) => ({
    tasks: {},

    startTask: (task) => {
        const timestamp = nowIso();
        set((state) => ({
            tasks: {
                ...state.tasks,
                [task.taskId]: {
                    ...task,
                    startedAt: task.startedAt || timestamp,
                    updatedAt: task.updatedAt || timestamp,
                },
            },
        }));
    },

    updateTask: (taskId, patch) => {
        set((state) => {
            const current = state.tasks[taskId];
            if (!current) return state;
            return {
                tasks: {
                    ...state.tasks,
                    [taskId]: {
                        ...current,
                        ...patch,
                        updatedAt: nowIso(),
                    },
                },
            };
        });
    },

    completeTask: (taskId) => {
        const timestamp = nowIso();
        set((state) => {
            const current = state.tasks[taskId];
            if (!current) return state;
            return {
                tasks: {
                    ...state.tasks,
                    [taskId]: {
                        ...current,
                        status: 'succeeded',
                        updatedAt: timestamp,
                        finishedAt: timestamp,
                    },
                },
            };
        });
    },

    failTask: (taskId, errorMessage) => {
        const timestamp = nowIso();
        set((state) => {
            const current = state.tasks[taskId];
            if (!current) return state;
            return {
                tasks: {
                    ...state.tasks,
                    [taskId]: {
                        ...current,
                        status: 'failed',
                        errorMessage,
                        updatedAt: timestamp,
                        finishedAt: timestamp,
                    },
                },
            };
        });
    },

    replaceTaskId: (currentTaskId, nextTaskId) => {
        if (currentTaskId === nextTaskId) return;
        set((state) => {
            const current = state.tasks[currentTaskId];
            if (!current || state.tasks[nextTaskId]) return state;
            const nextTasks = { ...state.tasks };
            delete nextTasks[currentTaskId];
            nextTasks[nextTaskId] = {
                ...current,
                taskId: nextTaskId,
                updatedAt: nowIso(),
            };
            return { tasks: nextTasks };
        });
    },

    dismissTask: (taskId) => {
        set((state) => {
            const nextTasks = { ...state.tasks };
            delete nextTasks[taskId];
            return { tasks: nextTasks };
        });
    },

    getVisibleTasks: () => {
        return Object.values(get().tasks)
            .filter(isVisibleTask)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, 5);
    },

    resetTasks: () => set({ tasks: {} }),
}));
