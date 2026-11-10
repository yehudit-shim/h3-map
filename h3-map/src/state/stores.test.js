import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore } from './dataStore.js'
import { useLayersStore } from './layersStore.js'
import { useNotifyStore } from './notifyStore.js'

const reset = () => useLayersStore.setState({ layers: [], activeId: null })
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
