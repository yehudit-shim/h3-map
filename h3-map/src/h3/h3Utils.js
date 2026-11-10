// Thin, validated wrappers around h3-js 4.x. Real Uber H3 indexes only
// (deck.gl's generic HexagonLayer binning is NOT H3; see docs/H3_IMPLEMENTATION.md).
import {
  cellArea,
  cellToChildren,
  cellToLatLng,
  cellToParent,
  cellToChildrenSize,
  getBaseCellNumber,
  gridDisk,
  polygonToCells,
  getHexagonAreaAvg,
  getHexagonEdgeLengthAvg,
  getResolution,
  isPentagon,
  isValidCell,
} from 'h3-js'

import { metersPerPixel } from '../lib/format.js'
import { CellStats, columnsToCells } from './aggregate.js'

export const H3_MIN_RES = 0
export const H3_MAX_RES = 15
/** Largest resolution difference accepted when listing children. */
export const MAX_CHILD_DELTA = 4
/** Hard cap on the number of cells any helper will return (fan-out guard). */
export const MAX_CELLS = 50000
/** Most cells the H3 layer will draw; finer grids are coarsened automatically (docs/H3_IMPLEMENTATION.md section 5, max_cells). */
export const MAX_DRAW_CELLS = 250000
/** Largest k accepted for a grid disk (k-ring): 3k(k+1)+1 cells. */
export const MAX_K = 10

/** Raised when a request would produce too many cells. The message is suitable for the UI. */
export class H3LimitError extends Error {
  constructor(message) {
    super(message)
    this.name = 'H3LimitError'
  }
}

/** H3 indexes are hex STRINGS. Numbers / BigInts are rejected so ids are never silently corrupted. */
export function assertCell(h3) {
  if (typeof h3 !== 'string' || !isValidCell(h3)) throw new Error(`Invalid H3 index: ${String(h3)}`)
  return h3
}

export function assertResolution(res) {
  if (!Number.isInteger(res) || res < H3_MIN_RES || res > H3_MAX_RES) throw new Error(`Invalid H3 resolution: ${String(res)} (expected an integer 0-15)`)
  return res
}

/** Parent cell at `res` (default: one level up). Throws for an invalid index or a resolution that is not coarser. */
export function parentCell(h3, res) {
  assertCell(h3)
  const own = getResolution(h3)
  const target = res === undefined ? own - 1 : assertResolution(res)
  if (target < 0) throw new Error('Resolution 0 cells have no parent')
  if (target > own) throw new Error(`Parent resolution ${target} is finer than the cell resolution ${own}`)
  return cellToParent(h3, target)
}

/**
 * Children at `res` (default: one level down). Refuses a resolution difference above MAX_CHILD_DELTA
 * and any request above MAX_CELLS cells (checked before expanding, so it cannot hang the tab).
 */
export function childCells(h3, res, { maxCells = MAX_CELLS } = {}) {
  assertCell(h3)
  const own = getResolution(h3)
  const target = res === undefined ? own + 1 : assertResolution(res)
  if (target < own) throw new Error(`Child resolution ${target} is coarser than the cell resolution ${own}`)
  if (target - own > MAX_CHILD_DELTA) throw new H3LimitError(`Children are limited to ${MAX_CHILD_DELTA} resolutions below the cell (asked for ${target - own}).`)
  const size = cellToChildrenSize(h3, target)
  if (size > maxCells) throw new H3LimitError(`That would create ${size.toLocaleString('en-US')} cells (limit ${maxCells.toLocaleString('en-US')}).`)
  return cellToChildren(h3, target)
}

/** All cells within grid distance k, including the cell itself. k is capped at MAX_K. */
export function gridDiskCells(h3, k) {
  assertCell(h3)
  if (!Number.isInteger(k) || k < 0) throw new Error(`Invalid k: ${String(k)} (expected an integer >= 0)`)
  if (k > MAX_K) throw new H3LimitError(`k is limited to ${MAX_K}.`)
  return gridDisk(h3, k)
}

/**
 * Cells whose centres lie inside a polygon. `polygon` is GeoJSON-style rings ([lon,lat] pairs) unless
 * isGeoJson is false ([lat,lon]). Refuses areas that would need more than `maxCells` cells.
 */
export function polygonCells(polygon, res, { isGeoJson = true, maxCells = 200000 } = {}) {
  assertResolution(res)
  if (!Array.isArray(polygon) || !polygon.length) throw new Error('Polygon has no rings')
  const outer = Array.isArray(polygon[0]?.[0]) ? polygon[0] : polygon
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (const p of outer) {
    const lon = isGeoJson ? p[0] : p[1]
    const lat = isGeoJson ? p[1] : p[0]
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Polygon has an invalid coordinate')
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
  }
  // bounding-box estimate (an upper bound for the polygon area) before the expensive fill
  const midLat = (minLat + maxLat) / 2
  const areaKm2 = (maxLon - minLon) * 111.32 * Math.cos((midLat * Math.PI) / 180) * (maxLat - minLat) * 110.57
  const estimate = areaKm2 / getHexagonAreaAvg(res, 'km2')
  if (estimate > maxCells) throw new H3LimitError(`That area would need about ${Math.round(estimate).toLocaleString('en-US')} cells at resolution ${res} (limit ${maxCells.toLocaleString('en-US')}). Use a coarser resolution.`)
  return polygonToCells(polygon, res, isGeoJson)
}

export function clampResolution(res) {
  return Math.min(H3_MAX_RES, Math.max(H3_MIN_RES, Math.round(res)))
}

/** Preferred on-screen cell width (flat-to-flat, CSS px). Consecutive resolutions differ by sqrt(7) = 2.65x in size,
 * so no integer choice can keep every zoom inside a band narrower than that factor; this target is the
 * geometric centre of the 30-60 px goal, which gives cells between about 26 and 69 px. */
export const TARGET_CELL_PX = 42
const FLAT_TO_FLAT = Math.sqrt(3)
const EDGE_M = Array.from({ length: H3_MAX_RES + 1 }, (_, r) => getHexagonEdgeLengthAvg(r, 'm'))

/** On-screen width (flat-to-flat, CSS px) of an average cell at a resolution, zoom and latitude (MapLibre, 512px tiles). */
export function cellPixelWidth(res, zoom, lat = 0) {
  const clampedLat = Math.max(-85, Math.min(85, lat))
  return (FLAT_TO_FLAT * EDGE_M[clampResolution(res)]) / metersPerPixel(clampedLat, zoom)
}

/**
 * Auto resolution from map zoom and latitude: the resolution whose cells are closest (in ratio) to
 * TARGET_CELL_PX on screen. Latitude matters because Web Mercator stretches the map by 1/cos(lat): at
 * 70°N a pixel covers about a third of the ground it covers at the equator, so the same zoom needs a finer grid. Monotonic in zoom and bounded to 0-15.
 */
export function zoomToH3Resolution(zoom, lat = 0) {
  let best = H3_MIN_RES
  let bestErr = Infinity
  for (let r = H3_MIN_RES; r <= H3_MAX_RES; r++) {
    const err = Math.abs(Math.log(cellPixelWidth(r, zoom, lat) / TARGET_CELL_PX))
    if (err < bestErr) {
      bestErr = err
      best = r
    }
  }
  return best
}

/** Average edge length (km) and area (km²) for a resolution, for the selector readout. */
export function resolutionInfo(res) {
  return {
    edgeKm: getHexagonEdgeLengthAvg(res, 'km'),
    areaKm2: getHexagonAreaAvg(res, 'km2'),
  }
}

/**
 * Aggregate point items ({position:[lon,lat], properties}) into H3 cells on the calling thread.
 * Small inputs and tests only: the app aggregates large point sets in the H3 worker (h3Client.js).
 * @param {{position:number[], properties:object}[]} points
 * @param {number} resolution 0-15
 * @param {{aggregation?: 'count'|'sum'|'avg'|'min'|'max', valueField?: string}} [opts]
 * @returns {{h3:string, count:number, value:number}[]} `value` is the aggregated metric
 */
export function aggregateToH3(points, resolution, { aggregation = 'count', valueField } = {}) {
  const stats = new CellStats(clampResolution(resolution))
  for (const p of points) stats.add(p.position[0], p.position[1], valueField ? p.properties?.[valueField] : undefined)
  return columnsToCells(stats.columns(aggregation))
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
