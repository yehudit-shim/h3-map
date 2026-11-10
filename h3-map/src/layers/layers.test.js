import { describe, expect, it } from 'vitest'
import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { HeatmapLayer, HexagonLayer } from '@deck.gl/aggregation-layers'
import { GeoJsonLayer, PathLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { buildDeckLayers, compatibleLayerTypes, createLayerConfig, getLayerType, listLayerTypes, registerLayerType } from './index.js'
import { registerLayerType as register } from './registry.js'
import { getSource } from '../data/sources.js'

const entriesFor = async (...ids) =>
  Object.fromEntries(await Promise.all(ids.map(async (id) => [id, { status: 'ready', data: await getSource(id).load() }])))
const ctx = { autoResolution: 8, selection: null }

describe('layer registry', () => {
  it('registers all twelve built-in types (eight data layers, MVT, database H3, XYZ and WMS)', () => {
    expect(listLayerTypes().map((t) => t.id).filter((id) => id !== 'toy').sort()).toEqual(['geojson', 'h3', 'h3cells', 'heatmap', 'hexagon', 'line', 'mvt', 'point', 'polygon', 'scatterplot', 'wms', 'xyz'])
  })
  it('rejects duplicates and incomplete plugins', () => {
    expect(() => registerLayerType(getLayerType('point'))).toThrow(/already registered/)
    expect(() => register({ id: 'x' })).toThrow(/missing required/)
  })
  it('lets a new layer type be added without touching existing code', () => {
    const type = { id: 'toy', label: 'Toy', geometry: ['point'], defaults: () => ({}), controls: [], prepareKey: () => 'k', prepare: () => ({}), createDeckLayers: () => [] }
    registerLayerType(type)
    expect(compatibleLayerTypes(getSource('sample-pois')).map((t) => t.id)).toContain('toy')
    expect(getLayerType('toy')).toBe(type)
  })
  it('filters compatible types by geometry', () => {
    const ids = (s) => compatibleLayerTypes(getSource(s)).map((t) => t.id)
    expect(ids('sample-routes')).toContain('line')
    expect(ids('sample-routes')).not.toContain('h3')
    expect(ids('sample-events')).toEqual(expect.arrayContaining(['h3', 'heatmap', 'hexagon', 'scatterplot', 'point', 'geojson']))
    expect(ids('sample-districts')).toContain('polygon')
  })
})

describe('layer factory', () => {
  it('creates serialisable configs with defaults', () => {
    const c = createLayerConfig('h3', 'sample-events')
    expect(JSON.parse(JSON.stringify(c))).toEqual(c)
    expect(c.style.valueField).toBe('value')
    expect(c.visible).toBe(true)
  })
  it('rejects unknown types, sources and incompatible geometry', () => {
    expect(() => createLayerConfig('nope', 'sample-events')).toThrow(/Unknown layer type/)
    expect(() => createLayerConfig('h3', 'nope')).toThrow(/Unknown data source/)
    expect(() => createLayerConfig('h3', 'sample-routes')).toThrow(/cannot draw/)
  })
})

describe('buildDeckLayers', () => {
  it('maps each layer type to the right deck.gl class', async () => {
    const entries = await entriesFor('sample-events', 'sample-routes', 'sample-districts', 'sample-mixed')
    const cases = [
      ['point', 'sample-events', ScatterplotLayer],
      ['scatterplot', 'sample-events', ScatterplotLayer],
      ['line', 'sample-routes', PathLayer],
      ['polygon', 'sample-districts', PolygonLayer],
      ['heatmap', 'sample-events', HeatmapLayer],
      ['hexagon', 'sample-events', HexagonLayer],
      ['h3', 'sample-events', H3HexagonLayer],
      ['geojson', 'sample-mixed', GeoJsonLayer],
    ]
    for (const [type, src, Cls] of cases) {
      const { layers, errors } = buildDeckLayers([createLayerConfig(type, src)], entries, ctx)
      expect(errors, type).toEqual([])
      expect(layers[0]).toBeInstanceOf(Cls)
    }
  })
  it('the generic hexagon layer is not an H3 layer and vice versa', async () => {
    const entries = await entriesFor('sample-events')
    const hex = buildDeckLayers([createLayerConfig('hexagon', 'sample-events')], entries, ctx).layers[0]
    const h3 = buildDeckLayers([createLayerConfig('h3', 'sample-events')], entries, ctx).layers[0]
    expect(hex).not.toBeInstanceOf(H3HexagonLayer)
    expect(h3).toBeInstanceOf(H3HexagonLayer)
  })
  it('H3 layer data are real cells at the requested resolution, and colours follow the values', async () => {
    const entries = await entriesFor('sample-events')
    const cfg = createLayerConfig('h3', 'sample-events', { style: { resolutionMode: 'fixed', resolution: 7 } })
    const { layers, prepared } = buildDeckLayers([cfg], entries, ctx)
    const p = prepared[cfg.id]
    expect(p.resolution).toBe(7)
    expect(layers[0].props.data).toBe(p.cells)
    const lo = p.cells.reduce((a, b) => (a.value < b.value ? a : b))
    const hi = p.cells.reduce((a, b) => (a.value > b.value ? a : b))
    expect(p.scale(lo.value)).not.toEqual(p.scale(hi.value))
    expect(layers[0].props.getHexagon(lo)).toBe(lo.h3)
  })
  it('auto resolution follows context; fixed ignores it; prepared data is memoised', async () => {
    const entries = await entriesFor('sample-events')
    const auto = createLayerConfig('h3', 'sample-events')
    expect(buildDeckLayers([auto], entries, { ...ctx, autoResolution: 6 }).prepared[auto.id].resolution).toBe(6)
    const a = buildDeckLayers([auto], entries, { ...ctx, autoResolution: 6 }).prepared[auto.id]
    const b = buildDeckLayers([auto], entries, { ...ctx, autoResolution: 6, selection: { layerId: 'z' } }).prepared[auto.id]
    expect(b).toBe(a)
    expect(buildDeckLayers([auto], entries, { ...ctx, autoResolution: 9 }).prepared[auto.id]).not.toBe(a)
    const fixed = createLayerConfig('h3', 'sample-events', { style: { resolutionMode: 'fixed', resolution: 5 } })
    expect(buildDeckLayers([fixed], entries, { ...ctx, autoResolution: 12 }).prepared[fixed.id].resolution).toBe(5)
  })
  it('adds a selection outline layer only for the matching resolution', async () => {
    const entries = await entriesFor('sample-events')
    const cfg = createLayerConfig('h3', 'sample-events', { style: { resolutionMode: 'fixed', resolution: 7 } })
    const { prepared } = buildDeckLayers([cfg], entries, ctx)
    const h3 = prepared[cfg.id].cells[0].h3
    expect(buildDeckLayers([cfg], entries, { ...ctx, selection: { layerId: cfg.id, h3, resolution: 7 } }).layers.length).toBe(2)
    expect(buildDeckLayers([cfg], entries, { ...ctx, selection: { layerId: cfg.id, h3, resolution: 6 } }).layers.length).toBe(1)
  })
  it('skips hidden layers and layers whose data is not ready; isolates failures', async () => {
    const entries = await entriesFor('sample-events')
    const hidden = { ...createLayerConfig('point', 'sample-events'), visible: false }
    const loading = createLayerConfig('line', 'sample-routes')
    expect(buildDeckLayers([hidden, loading], { ...entries, 'sample-routes': { status: 'loading' } }, ctx).layers).toEqual([])
    const bad = { ...createLayerConfig('point', 'sample-events'), type: 'missing' }
    const good = createLayerConfig('point', 'sample-events')
    const r = buildDeckLayers([bad, good], entries, ctx)
    expect(r.errors.length).toBe(1)
    expect(r.layers.length).toBe(1)
  })
  it('first config is drawn first (bottom)', async () => {
    const entries = await entriesFor('sample-events', 'sample-routes')
    const a = createLayerConfig('point', 'sample-events')
    const b = createLayerConfig('line', 'sample-routes')
    expect(buildDeckLayers([a, b], entries, ctx).layers.map((l) => l.id)).toEqual([a.id, b.id])
  })
  it('describe() gives inspector content for H3 cells', async () => {
    const entries = await entriesFor('sample-events')
    const cfg = createLayerConfig('h3', 'sample-events', { style: { resolutionMode: 'fixed', resolution: 8 } })
    const { prepared } = buildDeckLayers([cfg], entries, ctx)
    const cell = prepared[cfg.id].cells[0]
    const d = getLayerType('h3').describe(cell, cfg, prepared[cfg.id])
    expect(d.h3).toBe(cell.h3)
    expect(d.resolution).toBe(8)
    expect(d.sections[0].rows[0]).toEqual(['H3 index', cell.h3])
  })
})
