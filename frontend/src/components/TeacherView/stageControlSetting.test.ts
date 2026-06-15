import { describe, expect, it } from 'vitest';
import {
    EDIPT_STAGE_CONTROL_STORAGE_KEY,
    getStoredStageControlEnabled,
    nextStoredStageControlEnabled,
} from './stageControlSetting';

function memoryStorage(initial?: string) {
    const data: Record<string, string> = {};
    if (initial !== undefined) data[EDIPT_STAGE_CONTROL_STORAGE_KEY] = initial;

    return {
        getItem: (key: string) => data[key] ?? null,
        setItem: (key: string, value: string) => {
            data[key] = value;
        },
    };
}

describe('stage control setting', () => {
    it('defaults EDIPT stage control to disabled for feature testing', () => {
        expect(getStoredStageControlEnabled(memoryStorage())).toBe(false);
    });

    it('reads an explicit enabled value', () => {
        expect(getStoredStageControlEnabled(memoryStorage('true'))).toBe(true);
    });

    it('persists the next stage control value', () => {
        const storage = memoryStorage();

        const enabled = nextStoredStageControlEnabled(storage, true);

        expect(enabled).toBe(true);
        expect(storage.getItem(EDIPT_STAGE_CONTROL_STORAGE_KEY)).toBe('true');
    });
});
