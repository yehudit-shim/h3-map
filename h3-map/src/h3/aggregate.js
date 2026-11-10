// Point -> H3 cell aggregation core. Pure (no DOM, no worker APIs): used inside the H3 worker, by the
// main-thread fallback (tests) and by `aggregateToH3` in h3Utils.js.
import { latLngToCell } from 'h3-js'

export const AGGREGATIONS = ['count', 'sum', 'avg', 'min', 'max']

/** Accumulates per-cell statistics (count, sum, n, min, max) so any aggregation can be derived afterwards. */
export class CellStats {
  constructor(resolution) {
    this.resolution = resolution
    this.index = new Map() // h3 -> slot
    this.ids = []
    this.count = []
    this.sum = []
    this.n = []
    this.min = []
    this.max = []
  }

  /** Add one point. `value` may be NaN/undefined (counted, but not part of sum/avg/min/max). Invalid points are skipped. */
  add(lon, lat, value) {
    // lon outside ±180 is rejected (h3-js would silently wrap it: projected coordinates must not produce cells)
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return false
    const id = latLngToCell(lat, lon, this.resolution)
    let i = this.index.get(id)
    if (i === undefined) {
      i = this.ids.length
      this.index.set(id, i)
      this.ids.push(id)
      this.count.push(0)
      this.sum.push(0)
      this.n.push(0)
      this.min.push(Infinity)
      this.max.push(-Infinity)
    }
    this.count[i] += 1
    if (typeof value === 'number' && Number.isFinite(value)) {
      this.sum[i] += value
      this.n[i] += 1
      if (value < this.min[i]) this.min[i] = value
      if (value > this.max[i]) this.max[i] = value
    }
    return true
  }

  /** Metric of cell slot `i` for an aggregation ('count' | 'sum' | 'avg' | 'min' | 'max'). Cells without values give 0. */
  valueAt(i, aggregation) {
    switch (aggregation) {
      case 'sum': return this.sum[i]
      case 'avg': return this.n[i] ? this.sum[i] / this.n[i] : 0
      case 'min': return this.n[i] ? this.min[i] : 0
      case 'max': return this.n[i] ? this.max[i] : 0
      default: return this.count[i]
    }
  }

  get size() {
    return this.ids.length
  }

  /** Columnar result: ids plus typed arrays (cheap to transfer between threads). */
  columns(aggregation = 'count') {
    const count = new Float64Array(this.size)
    const value = new Float64Array(this.size)
    for (let i = 0; i < this.size; i++) {
      count[i] = this.count[i]
      value[i] = this.valueAt(i, aggregation)
    }
    return { resolution: this.resolution, ids: this.ids, count, value }
  }
}

/** Columnar result -> [{h3, count, value}] as drawn by H3HexagonLayer. */
export function columnsToCells({ ids, count, value }) {
  const cells = new Array(ids.length)
  for (let i = 0; i < ids.length; i++) cells[i] = { h3: ids[i], count: count[i], value: value[i] }
  return cells
}
