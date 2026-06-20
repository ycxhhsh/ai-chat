import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAsyncTaskStore } from './useAsyncTaskStore';

describe('useAsyncTaskStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-20T05:00:00.000Z'));
        useAsyncTaskStore.getState().resetTasks();
    });

    it('starts a visible async task with timestamps', () => {
        useAsyncTaskStore.getState().startTask({
            taskId: 'task-1',
            type: 'ai_chat',
            title: 'AI 正在回复',
            status: 'queued',
            progressText: '正在生成回复',
            retryable: true,
            retryPayload: { content: 'hello' },
            source: 'websocket',
            relatedId: 'conv-1',
        });

        const task = useAsyncTaskStore.getState().tasks['task-1'];

        expect(task).toMatchObject({
            taskId: 'task-1',
            type: 'ai_chat',
            status: 'queued',
            progressText: '正在生成回复',
            retryable: true,
            retryPayload: { content: 'hello' },
            relatedId: 'conv-1',
        });
        expect(task.startedAt).toBe('2026-06-20T05:00:00.000Z');
        expect(task.updatedAt).toBe('2026-06-20T05:00:00.000Z');
        expect(useAsyncTaskStore.getState().getVisibleTasks().map(t => t.taskId)).toEqual(['task-1']);
    });

    it('updates progress while preserving original start time', () => {
        useAsyncTaskStore.getState().startTask({
            taskId: 'task-1',
            type: 'ai_chat',
            title: 'AI 正在回复',
            status: 'running',
            retryable: true,
            source: 'websocket',
        });

        vi.setSystemTime(new Date('2026-06-20T05:01:00.000Z'));
        useAsyncTaskStore.getState().updateTask('task-1', {
            status: 'streaming',
            progressText: '已找到资料，正在整合资料',
        });

        const task = useAsyncTaskStore.getState().tasks['task-1'];

        expect(task.startedAt).toBe('2026-06-20T05:00:00.000Z');
        expect(task.updatedAt).toBe('2026-06-20T05:01:00.000Z');
        expect(task.status).toBe('streaming');
        expect(task.progressText).toBe('已找到资料，正在整合资料');
    });

    it('completes a task and hides it from visible tasks', () => {
        useAsyncTaskStore.getState().startTask({
            taskId: 'task-1',
            type: 'drawing',
            title: '正在生成设计草图',
            status: 'running',
            retryable: true,
            source: 'websocket',
        });

        vi.setSystemTime(new Date('2026-06-20T05:02:00.000Z'));
        useAsyncTaskStore.getState().completeTask('task-1');

        const task = useAsyncTaskStore.getState().tasks['task-1'];

        expect(task.status).toBe('succeeded');
        expect(task.finishedAt).toBe('2026-06-20T05:02:00.000Z');
        expect(useAsyncTaskStore.getState().getVisibleTasks()).toEqual([]);
    });

    it('marks failed tasks as visible and retryable', () => {
        useAsyncTaskStore.getState().startTask({
            taskId: 'task-1',
            type: 'learning_space_ai',
            title: 'AI 正在回应本步骤',
            status: 'running',
            retryable: true,
            source: 'http',
            retryPayload: { sessionId: 'session-1', content: 'question' },
        });

        vi.setSystemTime(new Date('2026-06-20T05:03:00.000Z'));
        useAsyncTaskStore.getState().failTask('task-1', 'AI 回复超时');

        const task = useAsyncTaskStore.getState().tasks['task-1'];

        expect(task.status).toBe('failed');
        expect(task.errorMessage).toBe('AI 回复超时');
        expect(task.finishedAt).toBe('2026-06-20T05:03:00.000Z');
        expect(useAsyncTaskStore.getState().getVisibleTasks().map(t => t.taskId)).toEqual(['task-1']);
    });

    it('dismisses a task', () => {
        useAsyncTaskStore.getState().startTask({
            taskId: 'task-1',
            type: 'ai_chat',
            title: 'AI 正在回复',
            status: 'failed',
            retryable: true,
            source: 'websocket',
        });

        useAsyncTaskStore.getState().dismissTask('task-1');

        expect(useAsyncTaskStore.getState().tasks['task-1']).toBeUndefined();
    });

    it('rekeys a temporary task to a backend task id while preserving retry payload', () => {
        useAsyncTaskStore.getState().startTask({
            taskId: 'request-1',
            type: 'ai_chat',
            title: 'AI 正在回复',
            status: 'running',
            retryable: true,
            retryPayload: { content: 'hello' },
            source: 'websocket',
        });

        vi.setSystemTime(new Date('2026-06-20T05:04:00.000Z'));
        useAsyncTaskStore.getState().replaceTaskId('request-1', 'task-1');

        expect(useAsyncTaskStore.getState().tasks['request-1']).toBeUndefined();
        expect(useAsyncTaskStore.getState().tasks['task-1']).toMatchObject({
            taskId: 'task-1',
            retryPayload: { content: 'hello' },
            updatedAt: '2026-06-20T05:04:00.000Z',
        });
    });
});
