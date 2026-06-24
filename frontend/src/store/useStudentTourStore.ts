import { create } from 'zustand';

const TOUR_VERSION = 'v1';

interface StudentTourProgress {
    version: string;
    hasSeen: boolean;
    completedAt?: string;
    dismissedAt?: string;
    lastStepId?: string;
}

interface StudentTourState {
    userId: string | null;
    isOpen: boolean;
    currentStepIndex: number;
    autoStarted: boolean;
    startAutoTour: (userId: string) => boolean;
    startManualTour: (userId: string) => void;
    nextStep: (stepIds: readonly string[]) => void;
    prevStep: () => void;
    finishTour: (stepIds: readonly string[]) => void;
    skipTour: () => void;
    resetForTest: () => void;
}

function getStorageKey(userId: string) {
    return `cothink-student-tour:${TOUR_VERSION}:${userId}`;
}

function readProgress(userId: string): StudentTourProgress | null {
    const raw = localStorage.getItem(getStorageKey(userId));
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as StudentTourProgress;
        return parsed.version === TOUR_VERSION ? parsed : null;
    } catch {
        return null;
    }
}

function writeProgress(userId: string, patch: StudentTourProgress) {
    localStorage.setItem(getStorageKey(userId), JSON.stringify(patch));
}

export const useStudentTourStore = create<StudentTourState>()((set, get) => ({
    userId: null,
    isOpen: false,
    currentStepIndex: 0,
    autoStarted: false,

    startAutoTour: (userId) => {
        const progress = readProgress(userId);
        if (progress?.hasSeen) {
            set({ userId, isOpen: false, autoStarted: false });
            return false;
        }
        set({ userId, isOpen: true, currentStepIndex: 0, autoStarted: true });
        return true;
    },

    startManualTour: (userId) => {
        set({ userId, isOpen: true, currentStepIndex: 0, autoStarted: false });
    },

    nextStep: (stepIds) => {
        const { userId, currentStepIndex } = get();
        const nextIndex = Math.min(currentStepIndex + 1, stepIds.length - 1);
        if (userId) {
            writeProgress(userId, {
                version: TOUR_VERSION,
                hasSeen: true,
                lastStepId: stepIds[nextIndex],
            });
        }
        set({ currentStepIndex: nextIndex });
    },

    prevStep: () => {
        set((state) => ({ currentStepIndex: Math.max(0, state.currentStepIndex - 1) }));
    },

    finishTour: (stepIds) => {
        const { userId } = get();
        if (userId) {
            writeProgress(userId, {
                version: TOUR_VERSION,
                hasSeen: true,
                completedAt: new Date().toISOString(),
                lastStepId: stepIds[stepIds.length - 1],
            });
        }
        set({ isOpen: false, autoStarted: false });
    },

    skipTour: () => {
        const { userId, currentStepIndex } = get();
        if (userId) {
            writeProgress(userId, {
                version: TOUR_VERSION,
                hasSeen: true,
                dismissedAt: new Date().toISOString(),
                lastStepId: String(currentStepIndex),
            });
        }
        set({ isOpen: false, autoStarted: false });
    },

    resetForTest: () => {
        set({
            userId: null,
            isOpen: false,
            currentStepIndex: 0,
            autoStarted: false,
        });
    },
}));

export { TOUR_VERSION, getStorageKey };
