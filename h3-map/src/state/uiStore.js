import { create } from 'zustand'
import { persist } from 'zustand/middleware'

const isNarrow = () => typeof window !== 'undefined' && window.innerWidth < 1024

export const useUiStore = create(
  persist(
    (set) => ({
      theme: 'dark',
      basemapId: 'dark',
      setTheme: (theme) => set({ theme }),
      setBasemap: (basemapId) => set({ basemapId }),
      // Panel layout is not persisted: it depends on the viewport. On narrow screens only one
      // panel is open at a time so they never cover each other.
      leftOpen: !isNarrow(),
      rightOpen: !isNarrow(),
      leftTab: 'layers',
      rightTab: 'inspector',
      setLeftOpen: (leftOpen) => set((s) => ({ leftOpen, rightOpen: isNarrow() && leftOpen ? false : s.rightOpen })),
      setRightOpen: (rightOpen) => set((s) => ({ rightOpen, leftOpen: isNarrow() && rightOpen ? false : s.leftOpen })),
      openLeftTab: (leftTab) => set((s) => ({ leftTab, leftOpen: true, rightOpen: isNarrow() ? false : s.rightOpen })),
      setRightTab: (rightTab) => set({ rightTab }),
    }),
    {
      name: 'h3map.ui',
      partialize: (s) => ({ theme: s.theme, basemapId: s.basemapId }),
    },
  ),
)
