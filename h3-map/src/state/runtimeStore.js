import { create } from 'zustand'

/** Derived per-layer facts computed while rendering (e.g. effective H3 resolution, cell count). */
export const useRuntimeStore = create((set, get) => ({
  info: {},
  prepared: {}, // layerId -> prepared render data (colour scales etc.), used by the legend
  setPrepared: (prepared) => set({ prepared }),
  setInfo: (info) => {
    if (JSON.stringify(info) !== JSON.stringify(get().info)) set({ info })
  },
}))
