import { describe, expect, it } from 'vitest'
import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { cellToChildren, cellToParent, getPentagons, gridDisk, latLngToCell } from 'h3-js'
import { buildDeckLayers, createLayerConfig, getLayerType } from './index.js'
import { MAX_OVERLAY_CELLS, buildH3OverlayLayers, overlayCells } from './h3Overlays.js'
import { getSource } from '../data/sources.js'
import { DEFAULT_OVERLAYS } from '../state/selectionStore.js'

const cell = latLngToCell(48.8606, 2.3376, 8)
const on = (patch) => ({ ...DEFAULT_OVERLAYS, ...patch })
const sorted = (a) => [...a].sort()

describe('H3 overlays', () => {
  it('draws nothing unless an overlay is switched on', () => {
    expect(overlayCells([cell], DEFAULT_OVERLAYS)).toMatchObject({ parent: [], children: [], kring: [], problems: {} })
    expect(buildH3OverlayLayers({ cells: [{ h3: cell }] }, DEFAULT_OVERLAYS)).toEqual([])
    expect(buildH3OverlayLayers(null, on({ parent: true }))).toEqual([])
  })

  it('parent, children and k-ring match h3-js exactly', () => {
    const o = overlayCells([cell], on({ parent: true, children: true, kring: true, childDelta: 2, k: 3 }))
    expect(o.parent).toEqual([cellToParent(cell, 7)])
    expect(sorted(o.children)).toEqual(sorted(cellToChildren(cell, 10)))
    expect(o.children).toHaveLength(49)
    expect(sorted(o.kring)).toEqual(sorted(gridDisk(cell, 3)))
    expect(o.kring).toHaveLength(37)
    expect(o.problems).toEqual({})
  })

  it('merges overlays of several selected cells without duplicates', () => {
    const [a, b] = gridDisk(cell, 1).slice(0, 2)
    const o = overlayCells([a, b], on({ parent: true, kring: true, k: 1 }))
    expect(new Set(o.kring).size).toBe(o.kring.length)
    expect(sorted(o.kring)).toEqual(sorted([...new Set([...gridDisk(a, 1), ...gridDisk(b, 1)])]))
    expect(o.parent.length).toBeLessThanOrEqual(2)
  })

  it('refuses children more than 4 resolutions down, k above the cap, and parents of resolution 0', () => {
    expect(overlayCells([cell], on({ children: true, childDelta: 5 })).problems.children).toMatch(/limited to 4/)
    expect(overlayCells([cell], on({ children: true, childDelta: 5 })).children).toEqual([])
    expect(overlayCells([cell], on({ kring: true, k: 11 })).problems.kring).toMatch(/limited to/)
    expect(overlayCells([latLngToCell(1, 1, 0)], on({ parent: true })).problems.parent).toMatch(/no parent/)
    expect(overlayCells([latLngToCell(1, 1, 14)], on({ children: true, childDelta: 2 })).problems.children).toMatch(/Invalid H3 resolution/)
  })

  it('caps the total number of overlay cells over a large selection', () => {
    const many = gridDisk(cell, 10) // 331 cells
    const o = overlayCells(many, on({ children: true, childDelta: 4 })) // 331 * 2401 cells
    expect(o.problems.children).toMatch(new RegExp(MAX_OVERLAY_CELLS.toLocaleString('en-US')))
  })

  it('handles pentagons', () => {
    const p = getPentagons(5)[0]
    const o = overlayCells([p], on({ children: true, kring: true, k: 1 }))
    expect(o.children).toHaveLength(6)
    expect(o.kring).toHaveLength(6)
  })

  it('builds one overlay deck layer per enabled overlay, with their own ids (not tree layers)', () => {
    const layers = buildH3OverlayLayers({ cells: [{ h3: cell }] }, on({ parent: true, children: true, kring: true }))
    expect(layers.every((l) => l instanceof H3HexagonLayer)).toBe(true)
    expect(layers.map((l) => l.id).sort()).toEqual(['h3-overlay::children', 'h3-overlay::kring', 'h3-overlay::parent'])
    const parent = layers.find((l) => l.id.endsWith('parent'))
    expect(parent.props.data).toEqual([cellToParent(cell, 7)])
    expect(parent.props.pickable).toBe(false)
  })
})

describe('H3 layer type with worker results', () => {
  const config = () => createLayerConfig('h3', 'sample-events', { style: { resolutionMode: 'fixed', resolution: 6 } })
  const entries = async () => ({ 'sample-events': { status: 'ready', data: await getSource('sample-events').load() } })

  it('draws the computed cells and reports their resolution, keeping a stale result until the next arrives', async () => {
    const c = config()
    const e = await entries()
    const computed = (id, resolution) => ({ [c.id]: { id, pending: false, value: { resolution, cells: [{ h3: latLngToCell(48.8, 2.3, resolution), count: 3, value: 7 }] } } })
    const first = buildDeckLayers([c], e, { autoResolution: 8, computed: computed(1, 6) })
    expect(first.prepared[c.id].resolution).toBe(6)
    expect(first.layers[0].props.data).toHaveLength(1)
    // user moves the slider to 9: until the worker answers, the old result is still drawn
    const c9 = { ...c, style: { ...c.style, resolution: 9 } }
    const stale = buildDeckLayers([c9], e, { autoResolution: 8, computed: { [c.id]: { ...computed(1, 6)[c.id], pending: true } } })
    expect(stale.prepared[c.id].resolution).toBe(6)
    const fresh = buildDeckLayers([c9], e, { autoResolution: 8, computed: computed(2, 9) })
    expect(fresh.prepared[c.id].resolution).toBe(9)
  })

  it('draws nothing (but does not fail) before the first result', async () => {
    const c = config()
    const r = buildDeckLayers([c], await entries(), { autoResolution: 8, computed: {} })
    expect(r.errors).toEqual([])
    expect(r.layers[0].props.data).toEqual([])
  })

  it('declares which inputs trigger a background computation', () => {
    const c = config()
    const key = (style) => getLayerType('h3').compute.key({ ...c, style: { ...c.style, ...style } }, { autoResolution: 8 })
    expect(key({})).toBe(key({ ramp: 'magma', coverage: 0.5 })) // styling does not recompute
    expect(key({ resolution: 7 })).not.toBe(key({}))
    expect(key({ aggregation: 'sum' })).not.toBe(key({ aggregation: 'avg' }))
  })

  it('selection outlines cover every selected cell of the layer', async () => {
    const c = config()
    const cells = [latLngToCell(48.8, 2.3, 6), latLngToCell(48.9, 2.4, 6)]
    const sel = { layerId: c.id, h3: cells[0], resolution: 6, cells: cells.map((h3) => ({ h3 })) }
    const computed = { [c.id]: { id: 1, value: { resolution: 6, cells: cells.map((h3) => ({ h3, count: 1, value: 1 })) } } }
    const { layers } = buildDeckLayers([c], await entries(), { autoResolution: 8, computed, selection: sel })
    const outline = layers.find((l) => l.id.endsWith('::selection'))
    expect(outline.props.data.map((d) => d.h3)).toEqual(cells)
  })

  it('a CSV / GeoJSON point source feeds the H3 type like any other point source', () => {
    const userPoints = { id: 'user-x', geometry: 'point', fields: [{ name: 'v', type: 'number' }] }
    // geometry compatibility is what the dialog uses to offer the type
    expect(getLayerType('h3').geometry).toContain(userPoints.geometry)
  })
})
