import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export type Theme = "light" | "dark" | "system";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

interface UIState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useUIStore = create<UIState>()(
  immer((set) => ({
    sidebarOpen: true,
    setSidebarOpen: (open) =>
      set((s) => {
        s.sidebarOpen = open;
      }),
    toggleSidebar: () =>
      set((s) => {
        s.sidebarOpen = !s.sidebarOpen;
      }),
    theme: getInitialTheme(),
    setTheme: (theme) =>
      set((s) => {
        s.theme = theme;
      }),
  })),
);
