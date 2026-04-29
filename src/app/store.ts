import { create } from 'zustand';

import type { AppSnapshot, ResolvedTheme } from './types';

export type ManageTab = 'all' | 'by-date' | 'completed' | 'trash' | 'io';
export type ManageSort = 'created-desc' | 'created-asc' | 'updated-desc' | 'alpha';

interface AppStore {
  snapshot: AppSnapshot | null;
  systemTheme: ResolvedTheme;
  status: string | null;
  composerOpen: boolean;
  composerFocusToken: number;
  widgetCollapsed: boolean;
  manageTab: ManageTab;
  manageSearch: string;
  manageSort: ManageSort;
  manageComposerOpen: boolean;
  manageComposerFocusToken: number;
  setSnapshot: (snapshot: AppSnapshot) => void;
  setSystemTheme: (theme: ResolvedTheme) => void;
  setStatus: (status: string | null) => void;
  openComposer: (focus?: boolean) => void;
  closeComposer: () => void;
  toggleWidgetCollapsed: () => void;
  setWidgetCollapsed: (collapsed: boolean) => void;
  setManageTab: (tab: ManageTab) => void;
  setManageSearch: (search: string) => void;
  setManageSort: (sort: ManageSort) => void;
  openManageComposer: (focus?: boolean) => void;
  closeManageComposer: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  snapshot: null,
  systemTheme: 'light',
  status: null,
  composerOpen: false,
  composerFocusToken: 0,
  widgetCollapsed: false,
  manageTab: 'all',
  manageSearch: '',
  manageSort: 'created-desc',
  manageComposerOpen: false,
  manageComposerFocusToken: 0,
  setSnapshot: (snapshot) => set({ snapshot }),
  setSystemTheme: (theme) => set({ systemTheme: theme }),
  setStatus: (status) => set({ status }),
  openComposer: (focus = true) =>
    set((state) => ({
      composerOpen: true,
      composerFocusToken: focus ? state.composerFocusToken + 1 : state.composerFocusToken,
    })),
  closeComposer: () => set({ composerOpen: false }),
  toggleWidgetCollapsed: () => set((state) => ({ widgetCollapsed: !state.widgetCollapsed })),
  setWidgetCollapsed: (collapsed) => set({ widgetCollapsed: collapsed }),
  setManageTab: (tab) => set({ manageTab: tab }),
  setManageSearch: (search) => set({ manageSearch: search }),
  setManageSort: (sort) => set({ manageSort: sort }),
  openManageComposer: (focus = true) =>
    set((state) => ({
      manageComposerOpen: true,
      manageComposerFocusToken: focus
        ? state.manageComposerFocusToken + 1
        : state.manageComposerFocusToken,
    })),
  closeManageComposer: () => set({ manageComposerOpen: false }),
}));
