import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDataStore } from './dataStore.js'
import { STORAGE_KEY, useLayersStore } from './layersStore.js'
import { useSelectionStore } from './selectionStore.js'
import { buildDeckLayers } from '../layers/index.js'
import { effectiveLayers, findNode } from '../layers/tree.js'
import { getSource } from '../data/sources.js'
import { useNotifyStore } from './notifyStore.js'

const reset = () => useLayersStore.getState().setTree([])
const names = () => useLayersStore.getState().layers.map((l) => l.name)

describe('layersStore', () => {
  beforeEach(reset)

  it('ships with a sensible default layer stack', () => {
    const { layers } = useLayersStore.getInitialState()
    expect(layers.map((l) => l.type)).toEqual(['h3', 'line', 'polygon'])
  })

  it('adds new layers on top and selects them', () => {
    const s = useLayersStore.getState()
    s.addLayer('point', 'sample-pois', { name: 'A' })
    const b = useLayersStore.getState().addLayer('line', 'sample-routes', { name: 'B' })
    expect(names()).toEqual(['B', 'A'])
    expect(useLayersStore.getState().activeId).toBe(b.id)
  })

  it('renames (ignoring blanks), toggles, sets opacity within 0..1', () => {
    const a = useLayersStore.getState().addLayer('point', 'sample-pois', { name: 'A' })
    const s = () => useLayersStore.getState()
    s().renameLayer(a.id, '  New name ')
    s().renameLayer(a.id, '   ')
    expect(names()).toEqual(['New name'])
    s().toggleVisible(a.id)
    expect(s().layers[0].visible).toBe(false)
    s().setOpacity(a.id, 4)
    expect(s().layers[0].opacity).toBe(1)
    s().setOpacity(a.id, -1)
    expect(s().layers[0].opacity).toBe(0)
  })

  it('reorders without going out of bounds', () => {
    const s = () => useLayersStore.getState()
    s().addLayer('point', 'sample-pois', { name: 'A' })
    s().addLayer('point', 'sample-pois', { name: 'B' })
    const c = s().addLayer('point', 'sample-pois', { name: 'C' })
    expect(names()).toEqual(['C', 'B', 'A'])
    s().moveLayer(c.id, -1)
    expect(names()).toEqual(['C', 'B', 'A'])
    s().moveLayer(c.id, 1)
    expect(names()).toEqual(['B', 'C', 'A'])
    s().moveLayer(c.id, 5)
    expect(names()).toEqual(['B', 'C', 'A'])
  })

  it('duplicates deeply and removes (clearing the active layer)', () => {
    const s = () => useLayersStore.getState()
    const a = s().addLayer('h3', 'sample-events', { name: 'A' })
    const copy = s().duplicateLayer(a.id)
    expect(copy.id).not.toBe(a.id)
    expect(names()).toEqual(['A copy', 'A'])
    s().updateStyle(copy.id, { resolution: 3 })
    expect(s().layers.find((l) => l.id === a.id).style.resolution).not.toBe(3)
    s().removeLayer(copy.id)
    expect(names()).toEqual(['A'])
    expect(s().activeId).toBeNull()
  })

  it('updateStyle merges into the style', () => {
    const a = useLayersStore.getState().addLayer('h3', 'sample-events')
    useLayersStore.getState().updateStyle(a.id, { resolutionMode: 'fixed', resolution: 10 })
    const st = useLayersStore.getState().layers[0].style
    expect(st.resolutionMode).toBe('fixed')
    expect(st.resolution).toBe(10)
    expect(st.valueField).toBe('value')
  })
})

describe('layersStore: groups, multiple layers and persistence', () => {
  beforeEach(reset)
  const s = () => useLayersStore.getState()

  it('groups the multi-selection, and group visibility/opacity reach the drawn layers', () => {
    const a = s().addLayer('point', 'sample-pois', { name: 'A' })
    const b = s().addLayer('line', 'sample-routes', { name: 'B' })
    s().addLayer('polygon', 'sample-districts', { name: 'C' })
    s().setActive(a.id)
    s().toggleSelected(b.id)
    expect(s().selectedIds).toEqual([a.id, b.id])
    const g = s().createGroup()
    expect(s().tree.map((n) => n.name)).toEqual(['C', 'New group'])
    expect(names()).toEqual(['C', 'B', 'A']) // flat list follows the tree
    expect(s().activeId).toBe(g.id)

    s().setOpacity(g.id, 0.5)
    s().setOpacity(a.id, 0.5)
    expect(effectiveLayers(s().tree).find((l) => l.id === a.id).opacity).toBeCloseTo(0.25)
    s().toggleVisible(g.id)
    const drawn = effectiveLayers(s().tree).filter((l) => l.visible).map((l) => l.name)
    expect(drawn).toEqual(['C'])
  })

  it('removing a group removes its layers and clears a selection inside it', () => {
    const a = s().addLayer('point', 'sample-pois', { name: 'A' })
    const g = s().createGroup([a.id], 'G')
    useSelectionStore.getState().select({ layerId: a.id, detail: { title: 'x', sections: [] } })
    s().removeNode(g.id)
    expect(s().tree).toEqual([])
    expect(s().layers).toEqual([])
    expect(useSelectionStore.getState().selected).toBeNull()
  })

  it('moves layers into and out of groups, and renames groups', () => {
    const a = s().addLayer('point', 'sample-pois', { name: 'A' })
    const g = s().createGroup([], 'G')
    expect(s().moveNode(a.id, g.id, 'inside')).toBe(true)
    expect(findNode(s().tree, g.id).children[0].id).toBe(a.id)
    expect(s().moveNode(g.id, a.id, 'before')).toBe(false) // into its own subtree
    s().outdent(a.id)
    expect(s().tree.map((n) => n.name)).toEqual(['G', 'A'])
    s().renameNode(g.id, ' Base maps ')
    expect(s().tree[0].name).toBe('Base maps')
    s().ungroup(g.id)
    expect(s().tree.map((n) => n.name)).toEqual(['A'])
  })

  it('keeps every layer configuration independent with several layers of the same type', async () => {
    const a = s().addLayer('polygon', 'sample-districts', { name: 'A' })
    const b = s().addLayer('polygon', 'sample-districts', { name: 'B' })
    s().updateStyle(a.id, { extruded: true, fillColor: '#ff0000' })
    s().updateStyle(b.id, { strokeWidth: 4 })
    const [la, lb] = [a.id, b.id].map((id) => s().layers.find((l) => l.id === id))
    expect(la.style.extruded).toBe(true)
    expect(lb.style.extruded).toBe(false)
    expect(lb.style.fillColor).not.toBe('#ff0000')
    expect(la.style.strokeWidth).not.toBe(4)
    const data = await getSource('sample-districts').load()
    const built = buildDeckLayers(effectiveLayers(s().tree), { 'sample-districts': { status: 'ready', data } }, { autoResolution: 8, selection: null })
    expect(built.layers.map((l) => l.id)).toEqual([a.id, b.id]) // bottom first, both drawn
    expect(built.layers[0].props.extruded).toBe(true)
    expect(built.layers[1].props.extruded).toBe(false)
  })

  it('auto-saves the tree to localStorage and restores it on reload', async () => {
    const a = s().addLayer('h3', 'sample-events', { name: 'Saved H3' })
    s().updateStyle(a.id, { resolutionMode: 'fixed', resolution: 9 })
    s().createGroup([a.id], 'Saved group')
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(saved.state.tree[0].name).toBe('Saved group')

    s().setTree([]) // simulate a fresh session, then reload from storage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    await useLayersStore.persist.rehydrate()
    expect(s().tree[0].name).toBe('Saved group')
    expect(s().layers[0].style.resolution).toBe(9)
  })

  it('ignores corrupt or invalid saved state', async () => {
    s().addLayer('point', 'sample-pois', { name: 'Keep' })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: { tree: [{ kind: 'layer', id: 'q', type: 'nope', sourceId: 'x' }] } }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await useLayersStore.persist.rehydrate()
    expect(names()).toEqual(['Keep'])
    localStorage.setItem(STORAGE_KEY, '{not json')
    await useLayersStore.persist.rehydrate().catch(() => {})
    expect(names()).toEqual(['Keep'])
  })

  it('exports and imports projects, and resets to the default layers', () => {
    s().addLayer('point', 'sample-pois', { name: 'A' })
    s().createGroup([s().layers[0].id], 'G')
    const file = JSON.stringify(s().exportProject())
    s().setTree([])
    const { count, problems } = s().loadProject(file)
    expect(count).toBe(1)
    expect(problems).toEqual([])
    expect(s().tree[0].name).toBe('G')
    expect(() => s().loadProject('{oops')).toThrow()
    expect(s().tree[0].name).toBe('G') // unchanged on failure
    s().resetLayers()
    expect(s().layers.map((l) => l.type)).toEqual(['h3', 'line', 'polygon'])
  })
})

describe('dataStore', () => {
  it('loads a source once and records bounds and counts', async () => {
    useDataStore.setState({ entries: {} })
    useDataStore.getState().ensure('sample-pois')
    expect(useDataStore.getState().entries['sample-pois'].status).toBe('loading')
    await useDataStore.getState().load('sample-pois')
    const e = useDataStore.getState().entries['sample-pois']
    expect(e.status).toBe('ready')
    expect(e.featureCount).toBe(300)
    expect(e.bounds.length).toBe(4)
  })
  it('reports unknown sources as errors that can be retried', async () => {
    useDataStore.setState({ entries: {} })
    await useDataStore.getState().load('nope')
    expect(useDataStore.getState().entries.nope.status).toBe('error')
  })
})

describe('notifyStore', () => {
  it('de-duplicates by key and dismisses', () => {
    useNotifyStore.setState({ toasts: [] })
    const s = () => useNotifyStore.getState()
    const id = s().notify('x', { key: 'k', timeout: 0 })
    expect(s().notify('x again', { key: 'k', timeout: 0 })).toBe(id)
    expect(s().toasts.length).toBe(1)
    s().dismiss(id)
    expect(s().toasts.length).toBe(0)
  })
})
