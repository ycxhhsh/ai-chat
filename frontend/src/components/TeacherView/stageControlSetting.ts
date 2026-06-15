export const EDIPT_STAGE_CONTROL_STORAGE_KEY = 'cothink-edipt-stage-control-enabled';

export interface StageControlStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export function getStoredStageControlEnabled(
    storage: StageControlStorage | undefined = globalThis.localStorage,
) {
    return storage?.getItem(EDIPT_STAGE_CONTROL_STORAGE_KEY) === 'true';
}

export function nextStoredStageControlEnabled(
    storage: StageControlStorage | undefined,
    enabled: boolean,
) {
    storage?.setItem(EDIPT_STAGE_CONTROL_STORAGE_KEY, enabled ? 'true' : 'false');
    return enabled;
}
