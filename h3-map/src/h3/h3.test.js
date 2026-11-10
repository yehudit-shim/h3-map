// H3 correctness tests (docs/TESTING_STRATEGY.md §5): known vectors, round trips, pentagons, parent/child
// consistency, guards, the worker job logic, and the zoom -> resolution calibration.
import { describe, expect, it } from 'vitest'
import {
  cellToBoundary, cellToChildren, cellToLatLng, cellToParent, getPentagons, getResolution, gridDisk, isPentagon, isValidCell, latLngToCell,
} from 'h3-js'
import { CellStats } from './aggregate.js'
import { createH3Service, isAbort } from './h3Client.js'
import { createH3Jobs } from './h3Jobs.js'
import {
  H3LimitError, MAX_CHILD_DELTA, MAX_K, aggregateToH3, assertCell, cellPixelWidth, childCells, gridDiskCells, parentCell, polygonCells, zoomToH3Resolution,
} from './h3Utils.js'
import { extractPointColumns } from './pointColumns.js'

// deterministic pseudo random numbers (tests must not depend on Math.random)
function rng(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}
const randomCells = (n, res, seed = 1) => {
  const r = rng(seed)
  return Array.from({ length: n }, () => latLngToCell(r() * 170 - 85, r() * 360 - 180, res))
}

describe('known vectors and round trips', () => {
  it('matches published vectors', () => {
    expect(latLngToCell(37.7749, -122.4194, 9)).toBe('89283082803ffff')
    expect(latLngToCell(37.3615593, -122.0553238, 5)).toBe('85283473fffffff')
  })

  it('cell centre maps back to the same cell for every resolution', () => {
    for (let res = 0; res <= 15; res++) {
      for (const h3 of randomCells(40, res, res + 3)) {
        const [lat, lon] = cellToLatLng(h3)
        expect(latLngToCell(lat, lon, res)).toBe(h3)
      }
    }
  })
})

describe('pentagons', () => {
  it('has 12 pentagons per resolution; 5 boundary vertices (10 at odd, Class III, resolutions)', () => {
    for (const res of [0, 3, 8, 15]) {
      const pents = getPentagons(res)
      expect(pents).toHaveLength(12)
      for (const p of pents) {
        expect(isPentagon(p)).toBe(true)
        // Class III (odd) resolutions add a distortion vertex on every edge that crosses an icosahedron edge
        expect(cellToBoundary(p)).toHaveLength(res % 2 === 1 ? 10 : 5)
      }
    }
    expect(cellToBoundary(latLngToCell(48.8, 2.3, 9))).toHaveLength(6)
  })

  it('has 6 children (not 7) and still round trips', () => {
    const p = getPentagons(4)[0]
    const kids = childCells(p, 5)
    expect(kids).toHaveLength(6)
    expect(kids.every((k) => cellToParent(k, 4) === p)).toBe(true)
    expect(childCells(p, 6)).toHaveLength(1 + (5 * (7 ** 2 - 1)) / 6) // 41
  })
})

describe('parent / child consistency', () => {
  it('children of a hexagon: 7^delta cells whose parent is the original', () => {
    const h3 = latLngToCell(48.8606, 2.3376, 6)
    for (let delta = 1; delta <= MAX_CHILD_DELTA; delta++) {
      const kids = childCells(h3, 6 + delta)
      expect(kids).toHaveLength(7 ** delta)
      expect(new Set(kids).size).toBe(kids.length)
      for (const k of kids) {
        expect(getResolution(k)).toBe(6 + delta)
        expect(parentCell(k, 6)).toBe(h3)
      }
      expect(kids).toEqual(cellToChildren(h3, 6 + delta)) // identical to h3-js
    }
  })

  it('parentCell defaults to one level up and matches h3-js', () => {
    for (const h3 of randomCells(30, 9, 5)) expect(parentCell(h3)).toBe(cellToParent(h3, 8))
  })

  it('refuses invalid or out-of-range requests', () => {
    const h3 = latLngToCell(48.8, 2.3, 6)
    expect(() => childCells(h3, 6 + MAX_CHILD_DELTA + 1)).toThrow(H3LimitError)
    expect(() => childCells(h3, 5)).toThrow(/coarser/)
    expect(() => childCells(h3, 16)).toThrow(/Invalid H3 resolution/)
    expect(() => childCells(latLngToCell(48.8, 2.3, 2), 6, { maxCells: 100 })).toThrow(/limit/)
    expect(() => parentCell(latLngToCell(1, 1, 0))).toThrow(/no parent/)
    expect(() => parentCell(h3, 7)).toThrow(/finer/)
  })
})

describe('grid disk (k-ring)', () => {
  it('has 3k(k+1)+1 cells for hexagons, all valid and matching h3-js', () => {
    const h3 = latLngToCell(48.8606, 2.3376, 8)
    for (let k = 0; k <= MAX_K; k++) {
      const disk = gridDiskCells(h3, k)
      expect(disk).toHaveLength(3 * k * (k + 1) + 1)
      expect(disk).toContain(h3)
      expect(disk.every(isValidCell)).toBe(true)
      expect([...disk].sort()).toEqual([...gridDisk(h3, k)].sort())
    }
  })

  it('works around a pentagon (fewer cells) and enforces the cap', () => {
    const p = getPentagons(5)[3]
    expect(gridDiskCells(p, 1)).toHaveLength(6)
    expect(() => gridDiskCells(p, MAX_K + 1)).toThrow(H3LimitError)
    expect(() => gridDiskCells(p, -1)).toThrow(/Invalid k/)
    expect(() => gridDiskCells(p, 1.5)).toThrow(/Invalid k/)
  })
})

describe('polygonToCells', () => {
  const square = [[[2.3, 48.8], [2.4, 48.8], [2.4, 48.9], [2.3, 48.9], [2.3, 48.8]]]
  it('returns cells whose centres are inside the polygon', () => {
    const cells = polygonCells(square, 8)
    expect(cells.length).toBeGreaterThan(20)
    for (const c of cells) {
      const [lat, lon] = cellToLatLng(c)
      expect(lon).toBeGreaterThanOrEqual(2.3)
      expect(lon).toBeLessThanOrEqual(2.4)
      expect(lat).toBeGreaterThanOrEqual(48.8)
      expect(lat).toBeLessThanOrEqual(48.9)
    }
  })
  it('refuses huge fills and bad input', () => {
    expect(() => polygonCells([[[-60, -30], [60, -30], [60, 60], [-60, 60], [-60, -30]]], 10)).toThrow(H3LimitError)
    expect(() => polygonCells(square, 16)).toThrow(/resolution/)
    expect(() => polygonCells([], 5)).toThrow(/no rings/)
    expect(() => polygonCells([[[2, 95], [3, 95], [3, 96], [2, 95]]], 5)).toThrow(/invalid coordinate/)
  })
})

describe('input validation', () => {
  it('never accepts numbers, BigInts, wrong lengths or garbage as an index', () => {
    for (const bad of [617700169958293500, 617700169958293503n, '89283082803ff', '89283082803fffff', 'not-an-index', '', null, undefined, {}]) {
      expect(() => assertCell(bad)).toThrow(/Invalid H3 index/)
      expect(() => parentCell(bad)).toThrow()
      expect(() => childCells(bad)).toThrow()
      expect(() => gridDiskCells(bad, 1)).toThrow()
    }
    expect(assertCell('89283082803ffff')).toBe('89283082803ffff')
  })
})

describe('aggregation core', () => {
  it('derives any aggregation from the same statistics', () => {
    const s = new CellStats(8)
    for (const [lon, lat, v] of [[2.33, 48.86, 10], [2.331, 48.861, 30], [2.331, 48.861, NaN], [2.4, 48.9, 5], [200, 0, 1], [0, 95, 1]]) s.add(lon, lat, v)
    expect(s.size).toBe(2) // two points were invalid
    const by = (agg) => Object.fromEntries(s.columns(agg).ids.map((id, i) => [id, s.columns(agg).value[i]]))
    const big = latLngToCell(48.86, 2.33, 8)
    expect(by('count')[big]).toBe(3) // NaN value still counts as a point
    expect(by('sum')[big]).toBe(40)
    expect(by('avg')[big]).toBe(20) // averaged over the 2 numeric values
    expect(by('min')[big]).toBe(10)
    expect(by('max')[big]).toBe(30)
  })
})

describe('point columns', () => {
  it('extracts Point and MultiPoint features with numeric fields', () => {
    const data = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { v: 1, name: 'a' }, geometry: { type: 'Point', coordinates: [1, 2] } },
        { type: 'Feature', properties: { v: 5 }, geometry: { type: 'MultiPoint', coordinates: [[3, 4], [5, 6]] } },
        { type: 'Feature', properties: { v: 9 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } },
        { type: 'Feature', properties: {}, geometry: null },
        { type: 'Feature', properties: { v: 'x' }, geometry: { type: 'Point', coordinates: [7, 8] } },
      ],
    }
    const c = extractPointColumns(data, ['v'])
    expect(c.count).toBe(4)
    expect([...c.lons]).toEqual([1, 3, 5, 7])
    expect([...c.lats]).toEqual([2, 4, 6, 8])
    expect([...c.fields.v].slice(0, 3)).toEqual([1, 5, 5])
    expect(c.fields.v[3]).toBeNaN()
  })
})

/** Run an H3 job in-process and collect its output. */
function harness(options) {
  const out = []
  const jobs = createH3Jobs((m) => out.push(m), options)
  return { out, send: (m) => jobs.handle(m), of: (type) => out.filter((m) => m.type === type) }
}
const pointsSet = (n, seed = 7) => {
  const r = rng(seed)
  const lons = new Float64Array(n), lats = new Float64Array(n), value = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    lons[i] = 2 + r() * 0.5
    lats[i] = 48.6 + r() * 0.4
    value[i] = Math.round(r() * 100)
  }
  return { lons, lats, fields: { value } }
}

describe('H3 worker jobs', () => {
  it('aggregates a cached dataset exactly like the synchronous reference', async () => {
    const h = harness({ slice: 500 })
    const ds = pointsSet(3000)
    await h.send({ type: 'dataset', id: 1, ...ds })
    await h.send({ type: 'aggregate', reqId: 1, dataset: 1, resolution: 7, aggregation: 'sum', valueField: 'value' })
    const r = h.of('result')[0]
    const ref = aggregateToH3(Array.from(ds.lons, (lon, i) => ({ position: [lon, ds.lats[i]], properties: { value: ds.fields.value[i] } })), 7, { aggregation: 'sum', valueField: 'value' })
    expect(r.ids).toHaveLength(ref.length)
    const got = new Map(r.ids.map((id, i) => [id, [r.count[i], r.value[i]]]))
    for (const c of ref) expect(got.get(c.h3)).toEqual([c.count, c.value])
    expect([...r.count].reduce((a, b) => a + b, 0)).toBe(3000)
  })

  it('reuses cached statistics: another aggregation or a repeat does not touch the points again', async () => {
    const h = harness({ slice: 500 })
    await h.send({ type: 'dataset', id: 1, ...pointsSet(2000) })
    await h.send({ type: 'aggregate', reqId: 1, dataset: 1, resolution: 8, aggregation: 'sum', valueField: 'value' })
    await h.send({ type: 'aggregate', reqId: 2, dataset: 1, resolution: 8, aggregation: 'avg', valueField: 'value' })
    await h.send({ type: 'aggregate', reqId: 3, dataset: 1, resolution: 6, aggregation: 'count' })
    await h.send({ type: 'aggregate', reqId: 4, dataset: 1, resolution: 8, aggregation: 'max', valueField: 'value' })
    expect(h.of('result').map((r) => r.cached)).toEqual([false, true, false, true])
    expect(h.of('dataset-ready')).toHaveLength(1) // the points were sent once
  })

  it('drops a stale request when a newer one arrives for the same slot', async () => {
    const h = harness({ slice: 100 })
    await h.send({ type: 'dataset', id: 1, ...pointsSet(5000) })
    const first = h.send({ type: 'aggregate', reqId: 1, slot: 'layer', dataset: 1, resolution: 9, aggregation: 'count' })
    const second = h.send({ type: 'aggregate', reqId: 2, slot: 'layer', dataset: 1, resolution: 5, aggregation: 'count' })
    await Promise.all([first, second])
    expect(h.of('cancelled').map((m) => m.reqId)).toEqual([1])
    expect(h.of('result').map((m) => m.reqId)).toEqual([2])
  })

  it('does not cancel requests of different slots', async () => {
    const h = harness({ slice: 100 })
    await h.send({ type: 'dataset', id: 1, ...pointsSet(1000) })
    await Promise.all([
      h.send({ type: 'aggregate', reqId: 1, slot: 'a', dataset: 1, resolution: 9, aggregation: 'count' }),
      h.send({ type: 'aggregate', reqId: 2, slot: 'b', dataset: 1, resolution: 5, aggregation: 'count' }),
    ])
    expect(h.of('result')).toHaveLength(2)
  })

  it('coarsens the grid when the result would have too many cells and reports the resolution used', async () => {
    const h = harness({ slice: 500 })
    await h.send({ type: 'dataset', id: 1, ...pointsSet(4000) })
    await h.send({ type: 'aggregate', reqId: 1, dataset: 1, resolution: 10, aggregation: 'count', maxCells: 5000 })
    await h.send({ type: 'aggregate', reqId: 2, dataset: 1, resolution: 10, aggregation: 'count', maxCells: 150 })
    await h.send({ type: 'aggregate', reqId: 3, dataset: 1, resolution: 10, aggregation: 'count', maxCells: 0 })
    const [fits, coarser, floor] = h.of('result')
    expect(fits).toMatchObject({ resolution: 10, requested: 10 })
    expect(coarser.requested).toBe(10)
    expect(coarser.resolution).toBeLessThan(10)
    expect(coarser.ids.length).toBeLessThanOrEqual(150)
    expect([...coarser.count].reduce((a, b) => a + b, 0)).toBe(4000) // no points lost by coarsening
    expect(floor.resolution).toBe(0) // never below resolution 0
  })

  it('reports problems as error messages', async () => {
    const h = harness()
    await h.send({ type: 'aggregate', reqId: 1, dataset: 99, resolution: 5 })
    await h.send({ type: 'dataset', id: 1, ...pointsSet(10) })
    await h.send({ type: 'aggregate', reqId: 2, dataset: 1, resolution: 16 })
    await h.send({ type: 'aggregate', reqId: 3, dataset: 1, resolution: 5, valueField: 'nope', aggregation: 'sum' })
    await h.send({ type: 'release', id: 1 })
    await h.send({ type: 'aggregate', reqId: 4, dataset: 1, resolution: 5 })
    expect(h.of('error').map((e) => e.message)).toEqual([
      expect.stringMatching(/no longer available/),
      expect.stringMatching(/Invalid H3 resolution/),
      expect.stringMatching(/not a numeric field/),
      expect.stringMatching(/no longer available/),
    ])
  })

  it('converts many coordinates to cells in bulk (invalid ones become null)', async () => {
    const h = harness()
    const lons = new Float64Array([2.3, 200, -122.4194]), lats = new Float64Array([48.8, 10, 37.7749])
    await h.send({ type: 'cells', reqId: 1, lons, lats, resolution: 9 })
    expect(h.of('cells-result')[0].ids).toEqual([latLngToCell(48.8, 2.3, 9), null, '89283082803ffff'])
  })
})

describe('H3 service (async API)', () => {
  const data = {
    type: 'FeatureCollection',
    features: Array.from({ length: 400 }, (_, i) => ({ type: 'Feature', properties: { v: i % 10 }, geometry: { type: 'Point', coordinates: [2.2 + (i % 20) * 0.01, 48.8 + Math.floor(i / 20) * 0.005] } })),
  }
  const spawnCounting = (posted) => (onMessage) => {
    const jobs = createH3Jobs((m) => queueMicrotask(() => onMessage(m)), { slice: 100 })
    return { post: (m) => { posted.push(m.type); void jobs.handle(m) }, stop() {} }
  }

  it('sends the points once and recomputes at another resolution without re-sending them', async () => {
    const posted = []
    const svc = createH3Service({ spawn: spawnCounting(posted) })
    const a = await svc.aggregateFeatures(data, ['v'], { resolution: 9, aggregation: 'avg', valueField: 'v' })
    const b = await svc.aggregateFeatures(data, ['v'], { resolution: 6, aggregation: 'avg', valueField: 'v' })
    expect(posted.filter((t) => t === 'dataset')).toHaveLength(1)
    expect(posted.filter((t) => t === 'aggregate')).toHaveLength(2)
    expect(a.resolution).toBe(9)
    expect(b.resolution).toBe(6)
    expect(a.cells.length).toBeGreaterThan(b.cells.length)
    expect(a.cells.reduce((s, c) => s + c.count, 0)).toBe(400)
    expect(a.cells.every((c) => isValidCell(c.h3) && typeof c.h3 === 'string')).toBe(true)
  })

  it('rejects an aborted request with an AbortError', async () => {
    const svc = createH3Service({ spawn: spawnCounting([]) })
    const ctl = new AbortController()
    const p = svc.aggregateFeatures(data, ['v'], { resolution: 9 }, { signal: ctl.signal })
    ctl.abort()
    await expect(p).rejects.toSatisfy(isAbort)
    await expect(svc.aggregateFeatures(data, [], { resolution: 9 }, { signal: ctl.signal })).rejects.toSatisfy(isAbort)
  })

  it('converts coordinates in bulk', async () => {
    const svc = createH3Service({ spawn: spawnCounting([]) })
    expect(await svc.cells(new Float64Array([2.3]), new Float64Array([48.8]), 8)).toEqual([latLngToCell(48.8, 2.3, 8)])
  })
})

describe('zoom -> resolution calibration (P5-03)', () => {
  it('is monotonic in zoom and bounded for every latitude', () => {
    for (const lat of [0, 45, 70, -60, 85]) {
      let prev = -1
      for (let z = 0; z <= 24; z += 0.25) {
        const r = zoomToH3Resolution(z, lat)
        expect(r).toBeGreaterThanOrEqual(0)
        expect(r).toBeLessThanOrEqual(15)
        expect(Number.isInteger(r)).toBe(true)
        expect(r).toBeGreaterThanOrEqual(prev)
        prev = r
      }
    }
  })

  it('keeps cells between about 26 and 70 px at latitudes 0, 45 and 70', () => {
    // Consecutive resolutions differ by sqrt(7) in size, so the best achievable band is about [T/1.63, T*1.63].
    for (const lat of [0, 45, 70]) {
      for (let z = 2.5; z <= 19; z += 0.25) {
        const px = cellPixelWidth(zoomToH3Resolution(z, lat), z, lat)
        expect(px, `lat ${lat} zoom ${z}`).toBeGreaterThan(25)
        expect(px, `lat ${lat} zoom ${z}`).toBeLessThan(70)
      }
    }
  })

  it('uses a finer grid towards the poles at the same zoom (Mercator makes cells look larger there)', () => {
    expect(zoomToH3Resolution(12, 70)).toBeGreaterThan(zoomToH3Resolution(12, 0))
    expect(zoomToH3Resolution(12, 45)).toBeGreaterThanOrEqual(zoomToH3Resolution(12, 0))
  })

  it('picks resolution 7 at the equator and 8 over Paris at zoom 11 (cells would be ~60 px wide at the equator, ~37 px at 48.8°N)', () => {
    expect(zoomToH3Resolution(11)).toBe(7)
    expect(zoomToH3Resolution(11, 48.8)).toBe(8)
  })
})
