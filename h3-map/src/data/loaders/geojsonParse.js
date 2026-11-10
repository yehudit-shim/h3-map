// Pure GeoJSON normalisation: runs inside the parse worker (and in tests / the no-Worker fallback).
// Input is an already JSON-parsed value; output is a clean FeatureCollection plus metadata.
//
// - Accepts FeatureCollection, Feature, a bare geometry or a GeometryCollection.
// - GeometryCollections are split into one feature per member geometry (properties are shared), so
//   every layer type, which dispatches on the geometry type, can draw them.
// - Features without geometry are dropped and counted; unknown geometry types are dropped and counted.
// - Fields and their types are inferred from `properties`.
// - The CRS is checked: GeoJSON (RFC 7946) is always EPSG:4326 lon/lat.
import { geometryClass, visitGeometry } from '../../lib/geo.js'

const GEOMETRY_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'])
const MAX_FIELDS = 200
const WGS84_NAME = /(^|[:/])(EPSG[:/]{1,2}4326|CRS:?84|CRS84|OGC:1\.3:CRS84|WGS ?84)$/i

/** Merge per-key statistics into inferred field types. */
class FieldStats {
  constructor() {
    this.stats = new Map() // key -> { numbers, others, nulls }
  }

  add(properties) {
    for (const key in properties) {
      let s = this.stats.get(key)
      if (!s) {
        if (this.stats.size >= MAX_FIELDS) continue
        s = { numbers: 0, others: 0, nulls: 0, nested: false }
        this.stats.set(key, s)
      }
      const v = properties[key]
      if (v === null || v === undefined || v === '') s.nulls++
      else if (typeof v === 'number' && Number.isFinite(v)) s.numbers++
      else if (typeof v === 'object') s.nested = true
      else s.others++
    }
  }

  /** @returns {{name:string,type:'number'|'string'}[]} */
  fields() {
    const out = []
    for (const [name, s] of this.stats) {
      if (s.nested && !s.numbers && !s.others) continue // objects/arrays cannot be styled or shown as a value
      out.push({ name, type: s.numbers > 0 && s.others === 0 ? 'number' : 'string' })
    }
    return out
  }
}

/** Name of a declared legacy `crs` member, or null. */
function declaredCrs(root) {
  const crs = root?.crs
  if (!crs || typeof crs !== 'object') return null
  const name = crs.properties?.name ?? crs.properties?.href ?? crs.name
  return typeof name === 'string' ? name : 'unknown'
}

function unwrapRoot(root) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('Not GeoJSON: the file does not contain a JSON object')
  if (root.type === 'FeatureCollection') {
    if (!Array.isArray(root.features)) throw new Error('Invalid GeoJSON: FeatureCollection has no "features" array')
    return root.features
  }
  if (root.type === 'Feature') return [root]
  if (root.type === 'GeometryCollection' || GEOMETRY_TYPES.has(root.type)) return [{ type: 'Feature', properties: {}, geometry: root }]
  throw new Error(`Not GeoJSON: unexpected "type" ${root.type === undefined ? '(missing)' : JSON.stringify(root.type)}`)
}

/** Expand a geometry into drawable members (GeometryCollections recursively). */
function* members(geometry) {
  if (!geometry || typeof geometry !== 'object') return
  if (geometry.type === 'GeometryCollection') {
    if (Array.isArray(geometry.geometries)) for (const g of geometry.geometries) yield* members(g)
  } else yield geometry
}

/** Cheap structural check so a corrupt geometry cannot crash a layer later. */
function validGeometry(g) {
  if (!GEOMETRY_TYPES.has(g.type) || !Array.isArray(g.coordinates)) return false
  if (g.type === 'Point') return g.coordinates.length >= 2 && Number.isFinite(g.coordinates[0]) && Number.isFinite(g.coordinates[1])
  return true
}

/**
 * @param {unknown} root parsed JSON
 * @returns {{
 *   data: {type:'FeatureCollection', features: object[]},
 *   fields: {name:string,type:'number'|'string'}[],
 *   geometry: 'point'|'line'|'polygon'|'mixed',
 *   bounds: number[]|null,
 *   featureCount: number,
 *   warnings: string[],
 *   projected: boolean,
 * }}
 */
export function normalizeGeoJson(root) {
  const input = unwrapRoot(root)
  const warnings = []
  const features = []
  const stats = new FieldStats()
  const classes = new Set()
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let outOfRange = 0
  let nullGeometry = 0
  let invalid = 0
  let splitCollections = 0
  let badCoordinates = 0
  let coordCount = 0

  const addCoord = (c) => {
    const x = c[0], y = c[1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      badCoordinates++
      return
    }
    coordCount++
    if (x < -180 || x > 180 || y < -90 || y > 90) outOfRange++
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || raw.type !== 'Feature') {
      invalid++
      continue
    }
    const properties = raw.properties && typeof raw.properties === 'object' && !Array.isArray(raw.properties) ? raw.properties : {}
    const geometry = raw.geometry
    if (!geometry) {
      nullGeometry++
      continue
    }
    const parts = geometry.type === 'GeometryCollection' ? [...members(geometry)] : [geometry]
    if (geometry.type === 'GeometryCollection') splitCollections++
    let used = 0
    for (const g of parts) {
      if (!validGeometry(g)) {
        invalid++
        continue
      }
      visitGeometry(g, addCoord)
      classes.add(geometryClass(g.type))
      features.push(geometry.type === 'GeometryCollection' || raw.properties !== properties ? { type: 'Feature', id: raw.id, properties, geometry: g } : raw)
      used++
    }
    if (used) stats.add(properties)
  }

  if (!features.length) {
    throw new Error(
      input.length ? 'No drawable features: every feature has an empty or unsupported geometry' : 'The GeoJSON contains no features',
    )
  }

  if (nullGeometry) warnings.push(`${nullGeometry.toLocaleString('en-US')} feature(s) without geometry were skipped`)
  if (invalid) warnings.push(`${invalid.toLocaleString('en-US')} feature(s) with an invalid or unsupported geometry were skipped`)
  if (badCoordinates) warnings.push(`${badCoordinates.toLocaleString('en-US')} coordinate(s) were not finite numbers and were ignored when computing the extent`)
  if (splitCollections) warnings.push(`${splitCollections.toLocaleString('en-US')} GeometryCollection(s) were split into one feature per member geometry`)

  // CRS check: GeoJSON is lon/lat in EPSG:4326. Warn on a declared different CRS or on projected-looking numbers.
  const crs = declaredCrs(root)
  if (crs && !WGS84_NAME.test(crs.trim())) {
    warnings.push(`The file declares the coordinate system "${crs}". GeoJSON must use EPSG:4326 (lon/lat); coordinates in another system will be drawn in the wrong place.`)
  }
  const projected = coordCount > 0 && outOfRange / coordCount > 0.01
  if (projected) {
    const fmt = (v) => Math.round(v).toLocaleString('en-US')
    warnings.push(
      `Coordinates look projected (x ${fmt(minX)}…${fmt(maxX)}, y ${fmt(minY)}…${fmt(maxY)}), not longitude/latitude. ` +
        'Reproject the data to EPSG:4326 (e.g. ogr2ogr -t_srs EPSG:4326); otherwise it will not appear on the map.',
    )
  } else if (outOfRange) {
    warnings.push(`${outOfRange.toLocaleString('en-US')} coordinate(s) are outside the valid longitude/latitude range`)
  }

  const bounds = Number.isFinite(minX) && !projected ? [minX, minY, maxX, maxY] : null
  return {
    data: { type: 'FeatureCollection', features },
    fields: stats.fields(),
    geometry: classes.size === 1 ? [...classes][0] : 'mixed',
    bounds,
    featureCount: features.length,
    warnings,
    projected,
  }
}
