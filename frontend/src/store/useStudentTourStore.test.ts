import { beforeEach, describe, expect, it } from 'vitest';
import { useStudentTourStore } from './useStudentTourStore';
import { studentTourSteps } from '../components/StudentTour/studentTourSteps';

const createStorageMock = () => {
    const data = new Map<string, string>();
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => { data.set(key, value); },
        removeItem: (key: string) => { data.delete(key); },
        clear: () => { data.clear(); },
    };
};

Object.defineProperty(globalThis, 'localStorage', {
    value: createStorageMock(),
    configurable: true,
    writable: true,
});

describe('useStudentTourStore', () => {
    beforeEach(() => {
        localStorage.clear();
        useStudentTourStore.getState().resetForTest();
    });

    it('auto-starts only when no persisted progress exists for the same user and version', () => {
        const started = useStudentTourStore.getState().startAutoTour('user-1');
        expect(started).toBe(true);
        expect(useStudentTourStore.getState().isOpen).toBe(true);

        useStudentTourStore.getState().skipTour();

        const restarted = useStudentTourStore.getState().startAutoTour('user-1');
        expect(restarted).toBe(false);
        expect(useStudentTourStore.getState().isOpen).toBe(false);
    });

    it('starts manual replay from the first step even after dismissal', () => {
        useStudentTourStore.getState().startAutoTour('user-1');
        useStudentTourStore.getState().nextStep(studentTourSteps.map((step) => step.id));
        useStudentTourStore.getState().skipTour();

        useStudentTourStore.getState().startManualTour('user-1');

        expect(useStudentTourStore.getState().currentStepIndex).toBe(0);
        expect(useStudentTourStore.getState().isOpen).toBe(true);
        expect(useStudentTourStore.getState().autoStarted).toBe(false);
    });

    it('marks the tour completed and stores the last step id', () => {
        useStudentTourStore.getState().startManualTour('user-2');
        useStudentTourStore.getState().finishTour(studentTourSteps.map((step) => step.id));

        const progress = JSON.parse(localStorage.getItem('cothink-student-tour:v1:user-2') || '{}');

        expect(progress.hasSeen).toBe(true);
        expect(progress.completedAt).toBeTruthy();
        expect(progress.lastStepId).toBe(studentTourSteps[studentTourSteps.length - 1]?.id);
        expect(useStudentTourStore.getState().isOpen).toBe(false);
    });
});
