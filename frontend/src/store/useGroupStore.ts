/**
 * 小组 Store — 小组管理、会话切换。
 * 持久化到 localStorage。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Group } from '../types';
import { api } from '../api';

interface GroupState {
    groups: Group[];
    currentGroupId: string | null;

    fetchGroups: () => Promise<void>;
    createGroup: (name: string) => Promise<Group>;
    joinGroup: (inviteCode: string) => Promise<void>;
    deleteGroup: (groupId: string) => Promise<void>;
    renameGroup: (groupId: string, name: string) => Promise<void>;
    setCurrentGroup: (groupId: string | null) => void;
    updateGroupStage: (groupId: string, stage: string) => void;
    clearGroups: () => void;
}

export const useGroupStore = create<GroupState>()(
    persist(
        (set) => ({
            groups: [],
            currentGroupId: null,

            fetchGroups: async () => {
                const groups = await api.groups.list();
                set({ groups });
            },

            createGroup: async (name) => {
                const group = await api.groups.create(name);
                set((s) => ({ groups: [...s.groups, group] }));
                return group;
            },

            joinGroup: async (inviteCode) => {
                await api.groups.join(inviteCode);
                // 重新拉取列表
                const groups = await api.groups.list();
                set({ groups });
            },

            deleteGroup: async (groupId) => {
                await api.groups.delete(groupId);
                set((s) => ({
                    groups: s.groups.filter(g => g.id !== groupId),
                    currentGroupId: s.currentGroupId === groupId ? null : s.currentGroupId,
                }));
            },

            renameGroup: async (groupId, name) => {
                await api.groups.rename(groupId, name);
                set((s) => ({
                    groups: s.groups.map(g =>
                        g.id === groupId ? { ...g, name } : g
                    ),
                }));
            },

            setCurrentGroup: (groupId) => set({ currentGroupId: groupId }),

            updateGroupStage: (groupId, stage) => set((s) => ({
                groups: s.groups.map(g => g.id === groupId ? { ...g, current_stage: stage } : g)
            })),

            clearGroups: () => set({ groups: [], currentGroupId: null }),
        }),
        {
            name: 'cothink-groups',
            partialize: (state) => ({
                groups: state.groups,
                currentGroupId: state.currentGroupId,
            }),
        }
    )
);
