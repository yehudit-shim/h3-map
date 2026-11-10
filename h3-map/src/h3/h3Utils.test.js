import { describe, expect, it } from 'vitest'
import { cellToParent, getResolution, isValidCell, latLngToCell } from 'h3-js'
import { aggregateToH3, clampResolution, describeCell, zoomToH3Resolution } from './h3Utils.js'

describe('h3Utils', () => {
  it('matches the known H3 vector for San Francisco at res 9', () => {
    expect(latLngToCell(37.7749, -122.4194, 9)).toBe('89283082803ffff')
  })

  it('clamps resolution to 0..15', () => {
    expect(clampResolution(-3)).toBe(0)
    expect(clampResolution(99)).toBe(15)
    expect(clampResolution(7.6)).toBe(8)
  })

  it('maps zoom to a bounded, monotonic resolution', () => {
    let prev = -1
    for (let z = 0; z <= 24; z += 0.25) {
      const r = zoomToH3Resolution(z)
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThanOrEqual(15)
      expect(r).toBeGreaterThanOrEqual(prev)
      prev = r
    }
    expect(zoomToH3Resolution(11)).toBe(7)
  })

  it('aggregates points into valid cells at the requested resolution', () => {
    const pts = [
      { position: [2.3376, 48.8606], properties: { v: 10 } },
      { position: [2.3377, 48.8607], properties: { v: 30 } },
      { position: [2.4, 48.9], properties: { v: 5 } },
      { position: [NaN, 48.9], properties: { v: 5 } }, // ignored
    ]
    const cells = aggregateToH3(pts, 8, { aggregation: 'avg', valueField: 'v' })
    expect(cells.length).toBe(2)
    for (const c of cells) {
      expect(isValidCell(c.h3)).toBe(true)
      expect(getResolution(c.h3)).toBe(8)
    }
    expect(cells.find((c) => c.count === 2).value).toBe(20)
    expect(aggregateToH3(pts, 8, { aggregation: 'sum', valueField: 'v' }).find((c) => c.count === 2).value).toBe(40)
    expect(aggregateToH3(pts, 8).find((c) => c.count === 2).value).toBe(2) // count
  })

  it('aggregation conserves the point count across resolutions', () => {
    const pts = Array.from({ length: 500 }, (_, i) => ({ position: [2.2 + (i % 25) * 0.01, 48.8 + Math.floor(i / 25) * 0.005], properties: {} }))
    for (const res of [4, 7, 10]) {
      expect(aggregateToH3(pts, res).reduce((s, c) => s + c.count, 0)).toBe(500)
    }
  })

  it('describes a cell with parent, children and area', () => {
    const h3 = latLngToCell(48.8606, 2.3376, 8)
    const d = describeCell(h3)
    expect(d.resolution).toBe(8)
    expect(d.parent).toBe(cellToParent(h3, 7))
    expect(d.childrenCount).toBe(7)
    expect(d.areaM2).toBeGreaterThan(500000)
    expect(d.isPentagon).toBe(false)
    expect(() => describeCell('nonsense')).toThrow(/Invalid H3/)
  })

  it('handles resolution boundaries in describeCell', () => {
    expect(describeCell(latLngToCell(10, 10, 0)).parent).toBeNull()
    expect(describeCell(latLngToCell(10, 10, 15)).childrenCount).toBe(0)
  })
})
