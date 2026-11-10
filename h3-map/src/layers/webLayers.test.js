import { describe, expect, it } from 'vitest'
import { BitmapLayer } from '@deck.gl/layers'
import { TileLayer, _WMSLayer as WMSLayer } from '@deck.gl/geo-layers'
import { buildDeckLayers, compatibleLayerTypes, createLayerConfig, getLayerType } from './index.js'
import { expandTileUrl, legendGraphicUrl, parseLayerList, urlProblem, xyzProblem } from './rasterUrl.js'
import { getSource } from '../data/sources.js'

const wmsConfig = (style = {}) => createLayerConfig('wms', null, { name: 'Roads', style: { url: 'https://example.com/wms', layers: 'roads, water', ...style } })

describe('URL helpers', () => {
  it('validates http(s) URLs and XYZ templates', () => {
    expect(urlProblem('https://a.example/x')).toBeNull()
    expect(urlProblem('ftp://a.example/x')).toMatch(/http/)
    expect(urlProblem('javascript:alert(1)')).toMatch(/http/)
    expect(urlProblem('')).toMatch(/Enter/)
    expect(urlProblem('not a url')).toMatch(/valid/)
    expect(xyzProblem('https://t.example/{z}/{x}/{y}.png')).toBeNull()
    expect(xyzProblem('https://t.example/{z}/{x}/{-y}.png')).toBeNull()
    expect(xyzProblem('https://t.example/tiles.png')).toMatch(/\{z\}/)
  })
  it('expands subdomain placeholders', () => {
    expect(expandTileUrl('https://{s}.t.example/{z}/{x}/{y}.png')).toEqual(['https://a.t.example/{z}/{x}/{y}.png', 'https://b.t.example/{z}/{x}/{y}.png', 'https://c.t.example/{z}/{x}/{y}.png'])
    expect(expandTileUrl('https://{a-b}.t.example/{z}/{x}/{y}')).toHaveLength(2)
    expect(expandTileUrl('https://t.example/{z}/{x}/{y}')).toEqual(['https://t.example/{z}/{x}/{y}'])
  })
  it('parses WMS layer lists and builds a legend URL', () => {
    expect(parseLayerList(' a, b ,,c')).toEqual(['a', 'b', 'c'])
    const url = new URL(legendGraphicUrl('https://example.com/wms?map=x', 'roads,water'))
    expect(url.searchParams.get('request')).toBe('GetLegendGraphic')
    expect(url.searchParams.get('layer')).toBe('roads')
    expect(url.searchParams.get('map')).toBe('x')
    expect(legendGraphicUrl('https://example.com/wms', '')).toBeNull()
  })
})

describe('XYZ and WMS layer types', () => {
  it('are sourceless and are never offered for data sources', () => {
    for (const id of ['xyz', 'wms']) {
      const t = getLayerType(id)
      expect(t.sourceless).toBe(true)
      expect(compatibleLayerTypes(getSource('sample-pois')).map((x) => x.id)).not.toContain(id)
      for (const key of ['defaults', 'controls', 'describe', 'legend', 'attribution', 'validate']) expect(t[key], `${id}.${key}`).toBeDefined()
    }
  })

  it('create serialisable configs with sourceId null and defaults (including attribution)', () => {
    const xyz = createLayerConfig('xyz', 'ignored')
    expect(xyz.sourceId).toBeNull()
    expect(xyz.name).toBe('XYZ tiles')
    expect(xyz.style.attribution).toMatch(/OpenStreetMap/)
    expect(JSON.parse(JSON.stringify(xyz))).toEqual(xyz)
    expect(wmsConfig().sourceId).toBeNull()
  })

  it('XYZ builds a TileLayer that renders tiles with BitmapLayer and applies opacity', () => {
    const config = createLayerConfig('xyz', null, { opacity: 0.4 })
    const { layers, errors, prepared } = buildDeckLayers([config], {}, {})
    expect(errors).toEqual([])
    expect(layers).toHaveLength(1)
    expect(layers[0]).toBeInstanceOf(TileLayer)
    expect(layers[0].props.opacity).toBe(0.4)
    expect(layers[0].props.pickable).toBe(false)
    const sub = layers[0].props.renderSubLayers({ id: 'x', data: 'img', tile: { bbox: { west: 1, south: 2, east: 3, north: 4 } } })
    expect(sub).toBeInstanceOf(BitmapLayer)
    expect(sub.props.bounds).toEqual([1, 2, 3, 4])
    expect(prepared[config.id].urls).toEqual(['https://tile.openstreetmap.org/{z}/{x}/{y}.png'])
  })

  it('XYZ reports tile errors through the context callback', () => {
    const calls = []
    const config = createLayerConfig('xyz', null, { name: 'Basemap' })
    const [layer] = buildDeckLayers([config], {}, { reportError: (id, msg) => calls.push([id, msg]) }).layers
    layer.props.onTileError(new Error('404'))
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe(config.id)
    expect(calls[0][1]).toMatch(/Basemap.*404/)
  })

  it('WMS builds a WMSLayer with the layer list, CRS and opacity', () => {
    const config = { ...wmsConfig({ srs: 'EPSG:4326' }), opacity: 0.7 }
    const [layer] = buildDeckLayers([config], {}, {}).layers
    expect(layer).toBeInstanceOf(WMSLayer)
    expect(layer.props).toMatchObject({ data: 'https://example.com/wms', serviceType: 'wms', layers: ['roads', 'water'], srs: 'EPSG:4326', opacity: 0.7 })
  })

  it('WMS image errors are reported', () => {
    const calls = []
    const [layer] = buildDeckLayers([wmsConfig()], {}, { reportError: (id, msg) => calls.push(msg) }).layers
    layer.props.onImageLoadError(1, new Error('boom'))
    expect(calls[0]).toMatch(/Roads.*boom/)
  })

  it('memoise prepared data by URL and recompute when it changes', () => {
    const config = createLayerConfig('xyz', null)
    const a = buildDeckLayers([config], {}, {}).prepared[config.id]
    expect(buildDeckLayers([{ ...config, opacity: 0.2 }], {}, {}).prepared[config.id]).toBe(a)
    const changed = { ...config, style: { ...config.style, url: 'https://other.example/{z}/{x}/{y}.png' } }
    expect(buildDeckLayers([changed], {}, {}).prepared[config.id]).not.toBe(a)
  })

  it('describe, legend and attribution give useful content', () => {
    const xyz = createLayerConfig('xyz', null)
    expect(getLayerType('xyz').attribution(xyz)).toMatch(/OpenStreetMap/)
    expect(getLayerType('xyz').describe(null, xyz).sections[0].rows).toEqual(expect.arrayContaining([['Host', 'tile.openstreetmap.org']]))
    expect(getLayerType('xyz').legend(xyz)).toMatchObject({ kind: 'note' })
    const wms = wmsConfig({ attribution: '© Agency' })
    expect(getLayerType('wms').attribution(wms)).toBe('© Agency')
    expect(getLayerType('wms').legend(wms)).toMatchObject({ kind: 'image' })
    expect(getLayerType('wms').legend(wmsConfig({ layers: '' }))).toMatchObject({ kind: 'note' })
    expect(getLayerType('wms').attribution(wmsConfig())).toBeNull()
  })

  it('validate rejects unusable styles', () => {
    expect(getLayerType('xyz').validate({ url: 'https://x.example/tiles.png' })).toBeTruthy()
    expect(getLayerType('wms').validate({ url: 'https://x.example/wms', layers: '' })).toMatch(/layer name/)
    expect(getLayerType('wms').validate({ url: 'https://x.example/wms', layers: 'a' })).toBeNull()
  })
})
