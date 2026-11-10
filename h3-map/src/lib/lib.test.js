import { describe, expect, it } from 'vitest'
import { boundsOf, featuresToPaths, featuresToPoints, featuresToPolygons, haversineKm, numericExtent } from './geo.js'
import { formatCoord, formatNumber, metersPerPixel, scaleDenominator } from './format.js'
import { parseSearch } from './searchParse.js'

const fc = (...geometries) => ({ type: 'FeatureCollection', features: geometries.map((geometry, i) => ({ type: 'Feature', geometry, properties: { i } })) })

describe('geo', () => {
  it('computes bounds across geometry types incl. collections', () => {
    const b = boundsOf(fc(
      { type: 'Point', coordinates: [1, 2] },
      { type: 'LineString', coordinates: [[-3, 0], [4, 5]] },
      { type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [10, -7] }] },
    ))
    expect(b).toEqual([-3, -7, 10, 5])
    expect(boundsOf({ type: 'FeatureCollection', features: [] })).toBeNull()
  })

  it('splits multi geometries', () => {
    expect(featuresToPoints(fc({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] }, { type: 'Point', coordinates: [2, 2] })).length).toBe(3)
    expect(featuresToPaths(fc({ type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] })).length).toBe(2)
    const sq = [[0, 0], [1, 0], [1, 1], [0, 0]]
    expect(featuresToPolygons(fc({ type: 'MultiPolygon', coordinates: [[sq], [sq]] }, { type: 'Polygon', coordinates: [sq] })).length).toBe(3)
  })

  it('ignores null geometries', () => {
    expect(featuresToPoints({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: {} }] })).toEqual([])
  })

  it('haversine: Paris to London is about 344 km', () => {
    expect(haversineKm([2.3522, 48.8566], [-0.1276, 51.5072])).toBeCloseTo(343.6, 0)
  })

  it('numericExtent skips non-numbers and defaults when empty', () => {
    expect(numericExtent([{ v: 3 }, { v: 'x' }, { v: NaN }, { v: -1 }], (d) => d.v)).toEqual([-1, 3])
    expect(numericExtent([], (d) => d.v)).toEqual([0, 1])
  })
})

describe('format', () => {
  it('formats numbers and coordinates safely', () => {
    expect(formatNumber(1234567.8)).toBe('1,234,568')
    expect(formatNumber(1.236)).toBe('1.24')
    expect(formatNumber(undefined)).toBe('–')
    expect(formatCoord(48.86061234)).toBe('48.86061')
    expect(formatCoord(null)).toBe('–')
  })
  it('scale shrinks as zoom increases', () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(78271.5, 0)
    expect(scaleDenominator(48.86, 10)).toBeGreaterThan(scaleDenominator(48.86, 14))
  })
})

describe('parseSearch', () => {
  it('parses coordinates', () => {
    expect(parseSearch('48.8606, 2.3376')).toEqual({ kind: 'coords', lat: 48.8606, lon: 2.3376 })
    expect(parseSearch('-33.9 151.2')).toEqual({ kind: 'coords', lat: -33.9, lon: 151.2 })
  })
  it('parses H3 indexes (case-insensitive) and rejects bad input', () => {
    expect(parseSearch('89283082803FFFF')).toEqual({ kind: 'h3', h3: '89283082803ffff' })
    expect(parseSearch('89283082803fffe')).toBeNull()
    expect(parseSearch('91, 10')).toBeNull()
    expect(parseSearch('')).toBeNull()
    expect(parseSearch('Paris')).toBeNull()
  })
})
