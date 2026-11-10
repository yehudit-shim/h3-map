import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { getPentagons, latLngToCell } from 'h3-js'
import { useDeckLayers } from '../map/useDeckLayers.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useNotifyStore } from '../state/notifyStore.js'
import { DEFAULT_OVERLAYS, useSelectionStore } from '../state/selectionStore.js'
import { getSource } from '../data/sources.js'
import Inspector from './Inspector.jsx'

const sel = (h3, extra = {}) => ({ layerId: 'L', h3, resolution: 8, value: 10, count: 2, detail: { title: `cell ${h3}`, h3, sections: [{ title: 'Cell', rows: [['H3 index', h3]] }] }, coordinate: [2, 48], ...extra })
const A = latLngToCell(48.8, 2.3, 8)
const B = latLngToCell(48.9, 2.4, 8)
const C = latLngToCell(48.7, 2.2, 8)
const store = () => useSelectionStore.getState()

beforeEach(() => {
  store().clear()
  useNotifyStore.setState({ toasts: [] })
})

describe('selection store: multi-select and overlays', () => {
  it('a plain select replaces the selection and resets overlays', () => {
    store().select(sel(A))
    store().setOverlay({ parent: true, k: 4 })
    store().select(sel(B))
    expect(store().selected.cells.map((c) => c.h3)).toEqual([B])
    expect(store().overlays).toEqual(DEFAULT_OVERLAYS)
  })

  it('shift-click adds cells, makes the newest the primary, and removes a selected cell again', () => {
    store().select(sel(A))
    store().toggleCell(sel(B))
    store().toggleCell(sel(C))
    expect(store().selected.cells.map((c) => c.h3)).toEqual([A, B, C])
    expect(store().selected.h3).toBe(C)
    store().toggleCell(sel(C)) // remove the primary: the previous one becomes primary
    expect(store().selected.cells.map((c) => c.h3)).toEqual([A, B])
    expect(store().selected.h3).toBe(B)
    expect(store().selected.detail.title).toBe(`cell ${B}`)
    store().toggleCell(sel(A))
    store().toggleCell(sel(B))
    expect(store().selected).toBeNull() // removing the last cell clears the selection
  })

  it('keeps overlays while cells are added, but a cell of another resolution or layer starts a new selection', () => {
    store().select(sel(A))
    store().setOverlay({ kring: true })
    store().toggleCell(sel(B))
    expect(store().overlays.kring).toBe(true)
    store().toggleCell(sel(latLngToCell(48.8, 2.3, 9), { resolution: 9 }))
    expect(store().selected.cells).toHaveLength(1)
    expect(store().selected.resolution).toBe(9)
    expect(store().overlays).toEqual(DEFAULT_OVERLAYS)
    store().toggleCell(sel(A, { layerId: 'other' }))
    expect(store().selected.layerId).toBe('other')
    expect(store().selected.cells).toHaveLength(1)
  })

  it('shift-click on an empty selection just selects', () => {
    store().toggleCell(sel(A))
    expect(store().selected.cells).toHaveLength(1)
  })

  it('non-H3 selections keep working', () => {
    store().select({ layerId: 'p', detail: { title: 'Feature', sections: [] }, coordinate: [1, 2] })
    expect(store().selected.cells).toBeUndefined()
  })
})

describe('Inspector: summary and overlay controls', () => {
  beforeEach(() => {
    useLayersStore.getState().setTree([])
    const layer = useLayersStore.getState().addLayer('h3', 'sample-events', { name: 'Grid', style: { aggregation: 'sum', valueField: 'value' } })
    useSelectionStore.setState({ selected: null })
    return layer
  })

  const select = (cells, layerId) => {
    const lid = layerId ?? useLayersStore.getState().layers[0].id
    store().select(sel(cells[0].h3, { layerId: lid, value: cells[0].value, count: cells[0].count }))
    for (const c of cells.slice(1)) store().toggleCell(sel(c.h3, { layerId: lid, value: c.value, count: c.count }))
  }

  it('shows no summary for one cell and an aggregate summary for several', () => {
    select([{ h3: A, value: 10, count: 2 }])
    const { rerender } = render(<Inspector />)
    expect(screen.queryByTestId('multi-summary')).toBeNull()
    act(() => select([{ h3: A, value: 10, count: 2 }, { h3: B, value: 30, count: 5 }, { h3: C, value: 20, count: 1 }]))
    rerender(<Inspector />)
    const summary = within(screen.getByTestId('multi-summary'))
    expect(summary.getByTestId('summary-Cells selected')).toHaveTextContent('3')
    expect(summary.getByTestId('summary-Points in cells')).toHaveTextContent('8')
    expect(summary.getByTestId('summary-sum of value: sum')).toHaveTextContent('60')
    expect(summary.getByTestId('summary-sum of value: mean')).toHaveTextContent('20')
    expect(summary.getByTestId('summary-sum of value: min')).toHaveTextContent('10')
    expect(summary.getByTestId('summary-sum of value: max')).toHaveTextContent('30')
    expect(summary.getByTestId('summary-Total area').textContent).toMatch(/km²/)
  })

  it('toggles the parent / children / k-ring overlays in the selection store', () => {
    select([{ h3: A, value: 1, count: 1 }])
    render(<Inspector />)
    fireEvent.click(screen.getByRole('switch', { name: 'Parent outline' }))
    expect(store().overlays.parent).toBe(true)
    expect(screen.getByTestId('overlay-count-parent')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('switch', { name: 'Children outlines' }))
    expect(screen.getByTestId('overlay-count-children')).toHaveTextContent('7')
    fireEvent.change(screen.getByLabelText(/Levels below/), { target: { value: '3' } })
    expect(store().overlays.childDelta).toBe(3)
    expect(screen.getByTestId('overlay-count-children')).toHaveTextContent('343')
    fireEvent.click(screen.getByRole('switch', { name: 'K-ring' }))
    fireEvent.change(screen.getByLabelText(/k \(rings\)/), { target: { value: '3' } })
    expect(store().overlays.k).toBe(3)
    expect(screen.getByTestId('overlay-count-kring')).toHaveTextContent('37')
  })

  it('offers children only up to 4 levels down and never beyond resolution 15', () => {
    select([{ h3: A, value: 1, count: 1 }])
    render(<Inspector />)
    fireEvent.click(screen.getByRole('switch', { name: 'Children outlines' }))
    expect(within(screen.getByLabelText(/Levels below/)).getAllByRole('option')).toHaveLength(4)
    act(() => store().select(sel(latLngToCell(1, 1, 14), { resolution: 14, layerId: useLayersStore.getState().layers[0].id })))
    fireEvent.click(screen.getByRole('switch', { name: 'Children outlines' }))
    expect(within(screen.getByLabelText(/Levels below/)).getAllByRole('option')).toHaveLength(1)
    act(() => store().select(sel(getPentagons(15)[0], { resolution: 15, layerId: useLayersStore.getState().layers[0].id })))
    expect(screen.getByRole('switch', { name: 'Children outlines' })).toBeDisabled()
    act(() => store().select(sel(latLngToCell(1, 1, 0), { resolution: 0, layerId: useLayersStore.getState().layers[0].id })))
    expect(screen.getByRole('switch', { name: 'Parent outline' })).toBeDisabled()
  })

  it('clears the overlay toggles with the selection', () => {
    select([{ h3: A, value: 1, count: 1 }])
    store().setOverlay({ parent: true, children: true })
    store().clear()
    expect(store().overlays).toEqual(DEFAULT_OVERLAYS)
  })
})

describe('selection validity after a resolution change (useDeckLayers)', () => {
  it('clears the selected cells with a notice when the layer is re-aggregated at another resolution', async () => {
    useLayersStore.getState().setTree([])
    const layer = useLayersStore.getState().addLayer('h3', 'sample-events', { style: { resolutionMode: 'fixed', resolution: 6, aggregation: 'count' } })
    useDataStore.setState({ entries: { 'sample-events': { status: 'ready', data: await getSource('sample-events').load() } } })
    const { result } = renderHook(() => useDeckLayers())
    await waitFor(() => expect(useLayersStore.getState().layers).toHaveLength(1))
    await waitFor(() => expect(result.current.layers.some((l) => l.id === layer.id && l.props.data.length > 0)).toBe(true), { timeout: 15000 })

    const cell = result.current.layers.find((l) => l.id === layer.id).props.data[0].h3
    act(() => {
      store().select(sel(cell, { layerId: layer.id, resolution: 6 }))
      store().toggleCell(sel(result.current.layers.find((l) => l.id === layer.id).props.data[1].h3, { layerId: layer.id, resolution: 6 }))
    })
    expect(store().selected.cells).toHaveLength(2)

    act(() => useLayersStore.getState().updateStyle(layer.id, { resolution: 7 }))
    await waitFor(() => expect(store().selected).toBeNull(), { timeout: 15000 })
    expect(useNotifyStore.getState().toasts.some((t) => /2 selected cells cleared.*resolution 7/.test(t.message))).toBe(true)
    // the grid itself now shows resolution 7 cells
    await waitFor(() => expect(result.current.layers.find((l) => l.id === layer.id).props.data[0].h3[1]).toBe('7'))
  }, 40000)

  it('keeps the selection while the resolution is unchanged (styling only)', async () => {
    useLayersStore.getState().setTree([])
    const layer = useLayersStore.getState().addLayer('h3', 'sample-events', { style: { resolutionMode: 'fixed', resolution: 6 } })
    useDataStore.setState({ entries: { 'sample-events': { status: 'ready', data: await getSource('sample-events').load() } } })
    const { result } = renderHook(() => useDeckLayers())
    await waitFor(() => expect(result.current.layers.some((l) => l.id === layer.id && l.props.data.length > 0)).toBe(true), { timeout: 15000 })
    const cell = result.current.layers.find((l) => l.id === layer.id).props.data[0].h3
    act(() => store().select(sel(cell, { layerId: layer.id, resolution: 6 })))
    act(() => useLayersStore.getState().updateStyle(layer.id, { ramp: 'magma' }))
    await new Promise((r) => setTimeout(r, 300))
    expect(store().selected?.h3).toBe(cell)
    vi.restoreAllMocks()
  }, 40000)
})
