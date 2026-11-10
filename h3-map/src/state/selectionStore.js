import { create } from 'zustand'

/** Overlay toggles for the selected H3 cell(s). Reset whenever a new selection starts or the selection is cleared. */
export const DEFAULT_OVERLAYS = { parent: false, children: false, kring: false, childDelta: 1, k: 1 }

const cellEntry = (sel) => ({ h3: sel.h3, value: sel.value, count: sel.count, detail: sel.detail })

/**
 * Current selection: { layerId, detail, coordinate, h3?, resolution?, cells? } or null.
 * - `detail` is the layer type's describe() output captured at click time (for H3: of the primary cell).
 * - For H3 layers `cells` holds every selected cell ({h3, value, count, detail}, in selection order);
 *   `h3`/`detail` are those of the primary (most recently added) cell. Shift-click adds / removes cells.
 * - `overlays` are the parent / children / k-ring toggles. They belong to the selection (they are not layers
 *   in the layer tree) and are reset by a plain click, by clearing, and when the resolution changes.
 */
export const useSelectionStore = create((set) => ({
  selected: null,
  overlays: DEFAULT_OVERLAYS,
  /** Replace the selection (plain click). */
  select: (selected) =>
    set({ selected: selected.h3 ? { ...selected, cells: [cellEntry(selected)] } : selected, overlays: DEFAULT_OVERLAYS }),
  /**
   * Shift-click: add the cell to the selection, or remove it if already selected. A cell of another layer
   * or resolution starts a new selection instead (cells of different resolutions cannot be summarised together).
   */
  toggleCell: (sel) =>
    set((s) => {
      const cur = s.selected
      if (!cur?.cells || cur.layerId !== sel.layerId || cur.resolution !== sel.resolution) {
        return { selected: { ...sel, cells: [cellEntry(sel)] }, overlays: DEFAULT_OVERLAYS }
      }
      const exists = cur.cells.some((c) => c.h3 === sel.h3)
      const cells = exists ? cur.cells.filter((c) => c.h3 !== sel.h3) : [...cur.cells, cellEntry(sel)]
      if (!cells.length) return { selected: null, overlays: DEFAULT_OVERLAYS }
      const primary = cells.at(-1)
      return { selected: { ...cur, cells, h3: primary.h3, detail: primary.detail, coordinate: sel.coordinate ?? cur.coordinate } }
    }),
  /** Merge more detail into the selected feature (the full attributes that arrive after a tile click). */
  patchDetail: (patch) => set((s) => (s.selected ? { selected: { ...s.selected, detail: { ...s.selected.detail, ...patch } } } : s)),
  setOverlay: (patch) => set((s) => ({ overlays: { ...s.overlays, ...patch } })),
  clear: () => set({ selected: null, overlays: DEFAULT_OVERLAYS }),
}))
