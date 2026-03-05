/**
 * 支架 Store — 铁律 4：支架软关闭 (Soft-Close)。
 *
 * 核心逻辑：
 * - 教师关闭支架 → 隐藏按钮（更新 is_active=false）
 * - 若学生已打开该支架弹窗 → 不强制关闭，允许提交
 * - 提交时若支架已被关闭 → 标记 scaffold_status: 'legacy'
 */
import { create } from 'zustand';
import type { Scaffold } from '../types';
import { api } from '../api';

interface ScaffoldState {
    scaffolds: Scaffold[];
    inputMessage: string;
    activeScaffoldId: string | null;
    /** 当前已打开弹窗的支架 ID（用于软关闭保护） */
    openModalId: string | null;
    /** 已被教师关闭但学生仍在使用的支架 ID 集合 */
    disabledScaffoldIds: Set<string>;

    fetchScaffolds: () => Promise<void>;
    setScaffolds: (scaffolds: Scaffold[]) => void;
    updateScaffoldState: (scaffoldId: string, isActive: boolean) => void;
    setInputMessage: (msg: string) => void;
    setActiveScaffold: (id: string | null) => void;
    /** 打开支架弹窗 */
    openModal: (scaffoldId: string) => void;
    /** 关闭支架弹窗 */
    closeModal: () => void;
    /** 铁律 4：处理支架被教师关闭 — 不强关已打开的弹窗 */
    handleScaffoldDisabled: (scaffoldId: string) => void;
    /** 判断当前支架提交是否应标记为 legacy */
    isScaffoldLegacy: (scaffoldId: string) => boolean;
    clearScaffolds: () => void;
}

export const useScaffoldStore = create<ScaffoldState>()((set, get) => ({
    scaffolds: [],
    inputMessage: '',
    activeScaffoldId: null,
    openModalId: null,
    disabledScaffoldIds: new Set(),

    fetchScaffolds: async () => {
        const scaffolds = await api.scaffolds.list();
        set({ scaffolds });
    },

    setScaffolds: (scaffolds) => set({ scaffolds }),

    updateScaffoldState: (scaffoldId, isActive) =>
        set((s) => ({
            scaffolds: s.scaffolds.map((sc) =>
                sc.scaffold_id === scaffoldId ? { ...sc, is_active: isActive } : sc
            ),
        })),

    setInputMessage: (msg) => set({ inputMessage: msg }),

    setActiveScaffold: (id) => set({ activeScaffoldId: id }),

    openModal: (scaffoldId) => set({ openModalId: scaffoldId }),

    closeModal: () => {
        const { openModalId, disabledScaffoldIds } = get();
        if (openModalId) {
            // 关闭弹窗时，从 disabled 集合中也清除
            const newDisabled = new Set(disabledScaffoldIds);
            newDisabled.delete(openModalId);
            set({ openModalId: null, disabledScaffoldIds: newDisabled });
        } else {
            set({ openModalId: null });
        }
    },

    handleScaffoldDisabled: (scaffoldId) => {
        const { openModalId, disabledScaffoldIds } = get();

        // 更新支架状态为未激活（隐藏按钮）
        set((s) => ({
            scaffolds: s.scaffolds.map((sc) =>
                sc.scaffold_id === scaffoldId ? { ...sc, is_active: false } : sc
            ),
        }));

        // 铁律 4：若学生已打开该支架弹窗，不强制关闭
        if (openModalId === scaffoldId) {
            const newDisabled = new Set(disabledScaffoldIds);
            newDisabled.add(scaffoldId);
            set({ disabledScaffoldIds: newDisabled });
            // 弹窗保持打开，学生可继续填写并提交
        }
    },

    isScaffoldLegacy: (scaffoldId) => {
        return get().disabledScaffoldIds.has(scaffoldId);
    },

    clearScaffolds: () => set({
        scaffolds: [],
        inputMessage: '',
        activeScaffoldId: null,
        openModalId: null,
        disabledScaffoldIds: new Set(),
    }),
}));
