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
      /** Node id whose properties (metadata) dialog is open, or null. Not persisted. */
      propertiesId: null,
      openProperties: (propertiesId) => set({ propertiesId }),
      closeProperties: () => set({ propertiesId: null }),
      /** Show the Style tab of the right panel (closing the left one on narrow screens). */
      openStyle: () => set((s) => ({ rightTab: 'style', rightOpen: true, leftOpen: isNarrow() ? false : s.leftOpen })),
    }),
    {
      name: 'h3map.ui',
      partialize: (s) => ({ theme: s.theme, basemapId: s.basemapId }),
    },
  ),
)
