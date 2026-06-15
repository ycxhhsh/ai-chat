import { describe, expect, it } from 'vitest';
import { shouldAppendStreamChunk } from './streamDedupe';

describe('shouldAppendStreamChunk', () => {
    it('accepts increasing chunk sequence numbers once', () => {
        const seen: Record<string, number> = {};

        expect(shouldAppendStreamChunk(seen, 'task-1', 1)).toBe(true);
        expect(shouldAppendStreamChunk(seen, 'task-1', 2)).toBe(true);
        expect(seen['task-1']).toBe(2);
    });

    it('drops duplicate or stale sequence numbers for the same task', () => {
        const seen: Record<string, number> = {};

        expect(shouldAppendStreamChunk(seen, 'task-1', 1)).toBe(true);
        expect(shouldAppendStreamChunk(seen, 'task-1', 1)).toBe(false);
        expect(shouldAppendStreamChunk(seen, 'task-1', 0)).toBe(false);
        expect(shouldAppendStreamChunk(seen, 'task-1', 2)).toBe(true);
    });

    it('keeps legacy chunks without task or sequence compatible', () => {
        const seen: Record<string, number> = {};

        expect(shouldAppendStreamChunk(seen, undefined, undefined)).toBe(true);
        expect(shouldAppendStreamChunk(seen, 'task-1', undefined)).toBe(true);
    });
});
