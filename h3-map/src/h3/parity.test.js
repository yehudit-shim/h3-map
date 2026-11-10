// Cross-check against h3-py. The fixture is generated once by scripts/gen_h3_fixture.py (needs `pip install h3`);
// until it is committed these tests are skipped, so a missing fixture is visible and never silently "passes".
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cellToLatLng, cellToParent, gridDisk, isPentagon } from 'h3-js'
import { CellStats } from './aggregate.js'
import { childCells } from './h3Utils.js'

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'h3py-parity.json')
const fixture = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null

describe.skipIf(!fixture)(`h3-js / app aggregation parity with ${fixture?.generator ?? 'h3-py (fixture not generated: run scripts/gen_h3_fixture.py)'}`, () => {
  it('was produced by h3-py', () => {
    expect(fixture.generator).toMatch(/^h3-py /)
  })

  for (const res of fixture?.resolutions ?? []) {
    it(`aggregates the same points to identical cells and statistics at resolution ${res}`, () => {
      const stats = new CellStats(res)
      for (const [lon, lat, value] of fixture.points) stats.add(lon, lat, value)
      const expected = fixture.aggregates[String(res)]
      expect(stats.size).toBe(Object.keys(expected).length)
      for (const [id, want] of Object.entries(expected)) {
        const i = stats.index.get(id)
        expect(i, `cell ${id}`).toBeDefined()
        expect(stats.count[i]).toBe(want.count)
        expect(stats.sum[i]).toBeCloseTo(want.sum, 6)
        expect(stats.min[i]).toBe(want.min)
        expect(stats.max[i]).toBe(want.max)
      }
    })
  }

  it('gives the same parent, children, grid disk, centre and pentagon flag', () => {
    for (const [id, want] of Object.entries(fixture.relations)) {
      expect(cellToParent(id, Number.parseInt(id[1], 16) - 1)).toBe(want.parent)
      expect([...childCells(id)].sort()).toEqual(want.children)
      expect([...gridDisk(id, 2)].sort()).toEqual(want.grid_disk_2)
      expect(isPentagon(id)).toBe(want.is_pentagon)
      const [lat, lon] = cellToLatLng(id)
      expect(lat).toBeCloseTo(want.center[0], 6)
      expect(lon).toBeCloseTo(want.center[1], 6)
    }
  })
})
