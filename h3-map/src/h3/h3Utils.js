// Thin, validated wrappers around h3-js 4.x. Real Uber H3 indexes only
// (deck.gl's generic HexagonLayer binning is NOT H3; see docs/H3_IMPLEMENTATION.md).
import {
  cellArea,
  cellToLatLng,
  cellToParent,
  cellToChildrenSize,
  getBaseCellNumber,
  getHexagonAreaAvg,
  getHexagonEdgeLengthAvg,
  getResolution,
  isPentagon,
  isValidCell,
  latLngToCell,
} from 'h3-js'

export const H3_MIN_RES = 0
export const H3_MAX_RES = 15

export function clampResolution(res) {
  return Math.min(H3_MAX_RES, Math.max(H3_MIN_RES, Math.round(res)))
}

/**
 * Auto resolution from map zoom so cells stay roughly 30-60px wide.
 * Heuristic from docs/H3_IMPLEMENTATION.md §5; calibrate visually (task P5-03).
 */
export function zoomToH3Resolution(zoom) {
  return clampResolution(zoom - 4.5)
}

/** Average edge length (km) and area (km²) for a resolution, for the selector readout. */
export function resolutionInfo(res) {
  return {
    edgeKm: getHexagonEdgeLengthAvg(res, 'km'),
    areaKm2: getHexagonAreaAvg(res, 'km2'),
  }
}

/**
 * Aggregate point items ({position:[lon,lat], properties}) into H3 cells.
 * @param {{position:number[], properties:object}[]} points
 * @param {number} resolution 0-15
 * @param {{aggregation?: 'count'|'sum'|'avg'|'min'|'max', valueField?: string}} [opts]
 * @returns {{h3:string, count:number, value:number}[]} `value` is the aggregated metric
 */
export function aggregateToH3(points, resolution, { aggregation = 'count', valueField } = {}) {
  const res = clampResolution(resolution)
  const cells = new Map()
  for (const p of points) {
    const [lon, lat] = p.position
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) continue
    const h3 = latLngToCell(lat, lon, res)
    const v = valueField ? p.properties?.[valueField] : undefined
    let c = cells.get(h3)
    if (!c) {
      c = { h3, count: 0, sum: 0, n: 0, min: Infinity, max: -Infinity }
      cells.set(h3, c)
    }
    c.count += 1
    if (typeof v === 'number' && Number.isFinite(v)) {
      c.sum += v
      c.n += 1
      if (v < c.min) c.min = v
      if (v > c.max) c.max = v
    }
  }
  const out = []
  for (const c of cells.values()) {
    let value
    switch (aggregation) {
      case 'sum': value = c.sum; break
      case 'avg': value = c.n ? c.sum / c.n : 0; break
      case 'min': value = c.n ? c.min : 0; break
      case 'max': value = c.n ? c.max : 0; break
      default: value = c.count
    }
    out.push({ h3: c.h3, count: c.count, value })
  }
  return out
}

/** Everything the inspector shows for a cell. Throws on an invalid index. */
export function describeCell(h3) {
  if (!isValidCell(h3)) throw new Error(`Invalid H3 index: ${h3}`)
  const resolution = getResolution(h3)
  const [lat, lon] = cellToLatLng(h3)
  return {
    h3,
    resolution,
    center: { lat, lon },
    areaM2: cellArea(h3, 'm2'),
    isPentagon: isPentagon(h3),
    baseCell: getBaseCellNumber(h3),
    parent: resolution > 0 ? cellToParent(h3, resolution - 1) : null,
    childrenCount: resolution < H3_MAX_RES ? cellToChildrenSize(h3, resolution + 1) : 0,
  }
}
