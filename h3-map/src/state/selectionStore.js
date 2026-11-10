import { create } from 'zustand'

/**
 * Current selection: { layerId, detail, h3?, resolution?, coordinate } or null.
 * `detail` is the layer type's describe() output captured at click time.
 */
export const useSelectionStore = create((set) => ({
  selected: null,
  select: (selected) => set({ selected }),
  clear: () => set({ selected: null }),
}))
