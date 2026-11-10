import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import '../layers/index.js'
import { clearToken } from '../api/index.js'
import { buildSourceInput } from '../data/pgPlan.js'
import { createPgSource, prunePgSources } from '../data/pgSources.js'
import { effectiveLayers } from '../layers/tree.js'
import { useAuthStore } from '../state/authStore.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useMapStore } from '../state/mapStore.js'
import { useSelectionStore } from '../state/selectionStore.js'
import { PROFILES, startMockApi } from '../test/mockApi.js'
import { useDeckLayers } from './useDeckLayers.js'
import { VIEW_DEBOUNCE_MS, useViewportSources } from './useViewportSources.js'

const mock = startMockApi()
beforeAll(() => mock.listen())
afterAll(() => mock.close())
const featureCalls = () => mock.calls.filter((c) => c.path.endsWith('/features'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const view = (n) => ({ bbox: [n, n, n + 1, n + 1], zoom: 12 })

beforeEach(async () => {
  useLayersStore.getState().setTree([])
  useDataStore.setState({ entries: {} })
  useMapStore.setState({ settled: null })
  useSelectionStore.getState().clear()
  await useAuthStore.getState().login('admin', 'right')
  mock.reset()
})
afterEach(() => {
  prunePgSources([])
  mock.server.resetHandlers()
  Object.keys(mock.flags).forEach((k) => delete mock.flags[k])
  clearToken()
})

const addBbox = () => {
  const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.events, strategy: 'bbox', columns: ['pop'] }))
  return useLayersStore.getState().addLayer('point', src.id)
}

describe('useViewportSources', () => {
  it('requests a new layer at once, then coalesces a burst of move ends into one request for the last viewport', async () => {
    addBbox()
    const { rerender } = renderHook(() => useViewportSources(effectiveLayers(useLayersStore.getState().tree), { autoResolution: 8 }))
    act(() => useMapStore.getState().setSettled(view(0)))
    await waitFor(() => expect(featureCalls()).toHaveLength(1))
    expect(featureCalls()[0].search.get('bbox')).toBe('0,0,1,1')

    act(() => {
      useMapStore.getState().setSettled(view(10))
      useMapStore.getState().setSettled(view(20))
      useMapStore.getState().setSettled(view(30))
    })
    rerender()
    await sleep(VIEW_DEBOUNCE_MS - 150)
    expect(featureCalls()).toHaveLength(1) // still waiting for the camera to stay still
    await waitFor(() => expect(featureCalls()).toHaveLength(2), { timeout: 2000 })
    expect(featureCalls()[1].search.get('bbox')).toBe('30,30,31,31')
  })

  it('does not request the same view twice', async () => {
    addBbox()
    renderHook(() => useViewportSources(effectiveLayers(useLayersStore.getState().tree), { autoResolution: 8 }))
    act(() => useMapStore.getState().setSettled(view(0)))
    await waitFor(() => expect(useDataStore.getState().entries[useLayersStore.getState().layers[0].sourceId]?.status).toBe('ready'))
    act(() => useMapStore.getState().setSettled({ ...view(0), bbox: [0.0000001, 0, 1, 1] }))
    await sleep(VIEW_DEBOUNCE_MS + 150)
    expect(featureCalls()).toHaveLength(1)
  })

  it('does not request hidden layers', async () => {
    const layer = addBbox()
    useLayersStore.getState().setVisible(layer.id, false)
    renderHook(() => useViewportSources(effectiveLayers(useLayersStore.getState().tree), { autoResolution: 8 }))
    act(() => useMapStore.getState().setSettled(view(0)))
    await sleep(100)
    expect(featureCalls()).toHaveLength(0)
  })

  it('re-requests an H3 source when the automatic resolution changes, with that resolution', async () => {
    const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.h3_pop, strategy: 'h3cells' }))
    useLayersStore.getState().addLayer('h3cells', src.id)
    let res = 7
    const { rerender } = renderHook(() => useViewportSources(effectiveLayers(useLayersStore.getState().tree), { autoResolution: res }))
    act(() => useMapStore.getState().setSettled(view(0)))
    const cellCalls = () => mock.calls.filter((c) => c.path.endsWith('/h3/cells'))
    await waitFor(() => expect(cellCalls()).toHaveLength(1))
    expect(cellCalls()[0].search.get('resolution')).toBe('7')
    res = 8
    rerender()
    await waitFor(() => expect(cellCalls()).toHaveLength(2), { timeout: 2000 })
    expect(cellCalls()[1].search.get('resolution')).toBe('8')
    expect(cellCalls()[1].search.get('maxCells')).toBe('250000') // the server limit from /config
  })

  it('a layer with a fixed resolution ignores the zoom-derived one', async () => {
    const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.h3_pop, strategy: 'h3cells' }))
    useLayersStore.getState().addLayer('h3cells', src.id, { style: { resolutionMode: 'fixed', resolution: 5 } })
    renderHook(() => useViewportSources(effectiveLayers(useLayersStore.getState().tree), { autoResolution: 9 }))
    act(() => useMapStore.getState().setSettled(view(0)))
    await waitFor(() => expect(mock.calls.some((c) => c.path.endsWith('/h3/cells'))).toBe(true))
    expect(mock.calls.find((c) => c.path.endsWith('/h3/cells')).search.get('resolution')).toBe('5')
  })
})

describe('clicking a tile feature', () => {
  it('shows the tile properties at once, then replaces them with all attributes fetched by id', async () => {
    const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.parcels, strategy: 'mvt', columns: ['pop'] }))
    const layer = useLayersStore.getState().addLayer('mvt', src.id)
    await useDataStore.getState().load(src.id)
    const { result } = renderHook(() => useDeckLayers())
    mock.reset()
    act(() => result.current.onClick({ object: { id: 42, properties: { pop: 7 } }, layer: { id: layer.id }, coordinate: [2.3, 48.8] }))
    let sel = useSelectionStore.getState().selected
    expect(sel.detail).toMatchObject({ featureId: 42, loading: true })
    expect(sel.detail.sections[0].rows).toEqual([['pop', '7']])
    await waitFor(() => expect(useSelectionStore.getState().selected.detail.loading).toBe(false))
    sel = useSelectionStore.getState().selected
    expect(sel.detail.sections[0].rows.map(([k]) => k)).toContain('secret_column')
    expect(mock.calls.at(-1)).toMatchObject({ method: 'GET', path: '/connections/anastasia/tables/public/parcels/features/42' })
  })

  it('ignores a late answer for a feature that is no longer selected', async () => {
    const src = createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.parcels, strategy: 'mvt', columns: ['pop'] }))
    const layer = useLayersStore.getState().addLayer('mvt', src.id)
    await useDataStore.getState().load(src.id)
    const { result } = renderHook(() => useDeckLayers())
    act(() => result.current.onClick({ object: { id: 1, properties: {} }, layer: { id: layer.id }, coordinate: [0, 0] }))
    act(() => useSelectionStore.getState().clear())
    await sleep(200)
    expect(useSelectionStore.getState().selected).toBeNull()
  })
})
