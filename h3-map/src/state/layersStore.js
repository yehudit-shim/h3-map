import { create } from 'zustand'
import { createLayerConfig, forgetLayer } from '../layers/index.js'
import { createId } from '../lib/ids.js'

/** First-run layers so the map shows something meaningful (sample data, no database needed). */
export function createInitialLayers() {
  return [
    createLayerConfig('h3', 'sample-events', { name: 'H3 · Event intensity' }),
    createLayerConfig('line', 'sample-routes'),
    createLayerConfig('polygon', 'sample-districts', { opacity: 0.6 }),
  ]
}

const move = (arr, from, to) => {
  if (to < 0 || to >= arr.length) return arr
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

const patchLayer = (layers, id, fn) => layers.map((l) => (l.id === id ? fn(l) : l))

/**
 * Layer list in UI order: index 0 is the TOP layer (drawn last). The map reverses it for deck.gl.
 * Layer configs are plain serialisable JSON.
 */
export const useLayersStore = create((set, get) => ({
  layers: createInitialLayers(),
  activeId: null,
  setActive: (id) => set({ activeId: id }),
  addLayer: (typeId, sourceId, overrides) => {
    const layer = createLayerConfig(typeId, sourceId, overrides)
    set((s) => ({ layers: [layer, ...s.layers], activeId: layer.id }))
    return layer
  },
  removeLayer: (id) => {
    forgetLayer(id)
    set((s) => ({ layers: s.layers.filter((l) => l.id !== id), activeId: s.activeId === id ? null : s.activeId }))
  },
  duplicateLayer: (id) => {
    const src = get().layers.find((l) => l.id === id)
    if (!src) return null
    const copy = { ...structuredClone(src), id: createId(src.type), name: `${src.name} copy` }
    set((s) => {
      const i = s.layers.findIndex((l) => l.id === id)
      const layers = s.layers.slice()
      layers.splice(i, 0, copy)
      return { layers, activeId: copy.id }
    })
    return copy
  },
  renameLayer: (id, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((s) => ({ layers: patchLayer(s.layers, id, (l) => ({ ...l, name: trimmed })) }))
  },
  toggleVisible: (id) => set((s) => ({ layers: patchLayer(s.layers, id, (l) => ({ ...l, visible: !l.visible })) })),
  setOpacity: (id, opacity) => set((s) => ({ layers: patchLayer(s.layers, id, (l) => ({ ...l, opacity: Math.min(1, Math.max(0, opacity)) })) })),
  updateStyle: (id, patch) => set((s) => ({ layers: patchLayer(s.layers, id, (l) => ({ ...l, style: { ...l.style, ...patch } })) })),
  /** direction -1 = towards the top of the list (drawn above), +1 = towards the bottom */
  moveLayer: (id, direction) =>
    set((s) => {
      const i = s.layers.findIndex((l) => l.id === id)
      return i < 0 ? s : { layers: move(s.layers, i, i + direction) }
    }),
}))
