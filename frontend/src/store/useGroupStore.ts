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
    setCurrentGroup: (groupId: string | null) => void;
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

            setCurrentGroup: (groupId) => set({ currentGroupId: groupId }),

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
