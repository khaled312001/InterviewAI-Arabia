import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_RECENT = 6;

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
  /** Recent route paths, newest first — feeds the empty command palette. */
  recentRoutes: string[];
  pushRecentRoute: (path: string) => void;
}

/**
 * Colour mode is deliberately NOT here — MUI owns it under `mui-mode` so the
 * anti-flash script in index.html and useColorScheme() stay the single source.
 */
export const useUi = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
      recentRoutes: [],
      pushRecentRoute: (path) =>
        set((s) => ({
          recentRoutes: [path, ...s.recentRoutes.filter((p) => p !== path)].slice(0, MAX_RECENT),
        })),
    }),
    { name: 'admin_ui_prefs' },
  ),
);
