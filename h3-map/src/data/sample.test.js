import { describe, expect, it } from 'vitest'
import { isValidCell } from 'h3-js'
import { dataSources, getSource } from './sources.js'
import { generateDistricts, generateEvents } from './sample/paris.js'
import { boundsOf, featuresToPoints } from '../lib/geo.js'
import { aggregateToH3 } from '../h3/h3Utils.js'

describe('sample data', () => {
  it('is deterministic', () => {
    expect(JSON.stringify(generateEvents(500, 1))).toBe(JSON.stringify(generateEvents(500, 1)))
    expect(JSON.stringify(generateEvents(500, 1))).not.toBe(JSON.stringify(generateEvents(500, 2)))
  })
  it('every source loads valid GeoJSON that matches its declared geometry and fields', async () => {
    for (const s of dataSources) {
      const fc = await s.load()
      expect(fc.type).toBe('FeatureCollection')
      expect(fc.features.length).toBeGreaterThan(0)
      for (const f of fc.features) {
        expect(f.geometry).toBeTruthy()
        for (const field of s.fields) expect(f.properties).toHaveProperty(field.name)
        if (s.geometry === 'point') expect(f.geometry.type).toBe('Point')
        if (s.geometry === 'line') expect(f.geometry.type).toBe('LineString')
        if (s.geometry === 'polygon') expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type)
        for (const field of s.fields.filter((x) => x.type === 'number')) expect(Number.isFinite(f.properties[field.name])).toBe(true)
      }
      const b = boundsOf(fc)
      expect(b[0]).toBeGreaterThan(2) // all around Paris
      expect(b[2]).toBeLessThan(3)
    }
  })
  it('events fall near Paris and values are in range', () => {
    const pts = featuresToPoints(generateEvents(2000))
    expect(pts.length).toBe(2000)
    expect(pts.filter((p) => p.position[0] > 2 && p.position[0] < 2.7 && p.position[1] > 48.6 && p.position[1] < 49.1).length).toBeGreaterThan(1950)
    expect(pts.every((p) => p.properties.value >= 0 && p.properties.value <= 100)).toBe(true)
  })
  it('polygons are closed rings and include a MultiPolygon', () => {
    const fc = generateDistricts()
    expect(fc.features.some((f) => f.geometry.type === 'MultiPolygon')).toBe(true)
    for (const f of fc.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
      for (const rings of polys) for (const r of rings) expect(r[0]).toEqual(r[r.length - 1])
    }
  })
  it('events produce a sensible number of valid H3 cells at res 8', async () => {
    const fc = await getSource('sample-events').load()
    const cells = aggregateToH3(featuresToPoints(fc), 8, { aggregation: 'avg', valueField: 'value' })
    expect(cells.length).toBeGreaterThan(50)
    expect(cells.length).toBeLessThan(2000)
    expect(cells.every((c) => isValidCell(c.h3) && c.value >= 0 && c.value <= 100)).toBe(true)
  })
})
