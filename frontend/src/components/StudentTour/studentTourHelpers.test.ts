import { describe, expect, it } from 'vitest';
import { findTourTargetElement, getStudentTourChannel } from './studentTourHelpers';

describe('studentTourHelpers', () => {
    it('maps every step id to the intended student channel', () => {
        expect(getStudentTourChannel('ai')).toBe('ai');
        expect(getStudentTourChannel('group')).toBe('group');
        expect(getStudentTourChannel('learning-space')).toBe('learning_space');
        expect(getStudentTourChannel('assignment')).toBe('assignment');
        expect(getStudentTourChannel('materials')).toBe('materials');
    });

    it('finds a tour target element by data attribute', () => {
        const target = { id: 'target' };
        const root = {
            querySelector: (selector: string) => selector === '[data-tour-target="sidebar-ai"]' ? target : null,
        };

        expect(findTourTargetElement('sidebar-ai', root as Pick<Document, 'querySelector'>)).toBe(target);
        expect(findTourTargetElement('missing', root as Pick<Document, 'querySelector'>)).toBeNull();
    });
});
