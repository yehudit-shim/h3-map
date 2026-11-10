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
      /** "Add layer" dialog: null when closed, else { tab, file } (file = a dropped / picked File to start with). */
      addLayerDialog: null,
      openAddLayer: (opts = {}) => set({ addLayerDialog: { tab: opts.tab ?? 'sample', file: opts.file ?? null } }),
      closeAddLayer: () => set({ addLayerDialog: null }),
      /** Database browser dialogs. All hold references (ids, names) only: never credentials. Not persisted. */
      loginOpen: false,
      openLogin: () => set({ loginOpen: true }),
      closeLogin: () => set({ loginOpen: false }),
      /** Table detail drawer: null or {connectionId, schema, table}. */
      tableDrawer: null,
      openTable: (tableDrawer) => set({ tableDrawer }),
      closeTable: () => set({ tableDrawer: null }),
      /** Add-to-map dialog: null or {connectionId, schema, table}. */
      addToMap: null,
      openAddToMap: (addToMap) => set({ addToMap }),
      closeAddToMap: () => set({ addToMap: null }),
      /** Connection editor (admin): null or {connection?} (no connection = create). */
      connectionDialog: null,
      openConnectionDialog: (connection = null) => set({ connectionDialog: { connection } }),
      closeConnectionDialog: () => set({ connectionDialog: null }),
      /** Show the Style tab of the right panel (closing the left one on narrow screens). */
      openStyle: () => set((s) => ({ rightTab: 'style', rightOpen: true, leftOpen: isNarrow() ? false : s.leftOpen })),
    }),
    {
      name: 'h3map.ui',
      partialize: (s) => ({ theme: s.theme, basemapId: s.basemapId }),
    },
  ),
)
