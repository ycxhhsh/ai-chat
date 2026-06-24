import { describe, expect, it } from 'vitest';
import { studentTourSteps } from './studentTourSteps';

describe('studentTourSteps', () => {
    it('defines the five expected student tour steps in order', () => {
        expect(studentTourSteps.map((step) => step.id)).toEqual([
            'ai',
            'group',
            'learning-space',
            'assignment',
            'materials',
        ]);
    });

    it('uses unique target keys for every step', () => {
        const keys = studentTourSteps.map((step) => step.targetKey);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
