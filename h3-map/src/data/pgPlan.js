// Decides how a database table can be put on the map: which strategies apply to its profile, which one the server
// recommends, which layer type fits, and what source to create. Pure functions over the /profile response.
import { fieldsFromColumns, postgisGeometryClass } from './pgSources.js'

const POINT = (g) => postgisGeometryClass(g.type) === 'point'
const fmt = (n) => (n == null ? 'unknown' : n.toLocaleString('en-US'))

/** The strategy the server recommends, translated to what this table can actually use. */
function mapRecommendation(profile) {
  const rec = profile.recommendedStrategy
  const geom = profile.geometry ?? []
  const h3 = profile.h3 ?? []
  if (!rec) return null
  if (rec !== 'aggregate') return geom.length ? rec : h3.length ? 'h3cells' : null
  // `aggregate`: a very large point table, or an H3 table without geometry
  if (!geom.length) return h3.length ? 'h3cells' : null
  return geom.some(POINT) ? 'h3aggregate' : 'mvt'
}

/**
 * @param {object} profile response of GET .../profile
 * @param {{maxFeaturesNoBbox?:number}} [limits]
 * @returns {{options: {strategy:string, label:string, description:string, recommended:boolean, warning?:string}[], recommended: string|null, default: string|null}}
 */
export function planStrategies(profile, limits = {}) {
  const geom = profile.geometry ?? []
  const h3 = profile.h3 ?? []
  const rows = profile.exactRows ?? profile.estimatedRows
  const maxNoBbox = limits.maxFeaturesNoBbox ?? 50_000
  const recommended = mapRecommendation(profile)
  const options = []
  if (geom.length) {
    options.push({
      strategy: 'json',
      label: 'GeoJSON, whole table',
      description: 'One request; fastest to style. For small tables.',
      warning: rows != null && rows > maxNoBbox ? `About ${fmt(rows)} rows: the server will refuse to send the whole table without a viewport.` : undefined,
    })
    options.push({ strategy: 'bbox', label: 'GeoJSON, current view', description: 'Reloads the features in view when you stop moving the map.' })
    options.push({ strategy: 'mvt', label: 'Vector tiles (MVT)', description: 'Streams tiles; the right choice for large tables. Click a feature for all its attributes.' })
    if (geom.some(POINT)) options.push({ strategy: 'h3aggregate', label: 'H3 aggregate (from points)', description: 'The database bins the points into H3 cells for the view.' })
  }
  if (h3.length) options.push({ strategy: 'h3cells', label: 'H3 cells (existing H3 table)', description: 'Reads the H3 column and rolls it up to the zoom level.' })
  for (const o of options) o.recommended = o.strategy === recommended
  const def = options.some((o) => o.strategy === recommended) ? recommended : (options[0]?.strategy ?? null)
  return { options, recommended, default: def }
}

/** Layer type suggested for a strategy and geometry class. */
export function defaultLayerType(strategy, geometry) {
  if (strategy === 'mvt') return 'mvt'
  if (strategy === 'h3cells' || strategy === 'h3aggregate') return 'h3cells'
  return { point: 'point', line: 'line', polygon: 'polygon' }[geometry] ?? 'geojson'
}

/** Columns the user may choose as attributes / H3 values (geometry and H3 index columns are not attributes). */
export const attributeColumns = (profile) => fieldsFromColumns(profile.columns)

/** Attribute columns fetched by default: numeric ones first, at most `max`. */
export function defaultColumns(profile, max = 8) {
  const fields = attributeColumns(profile)
  const ordered = [...fields.filter((f) => f.type === 'number'), ...fields.filter((f) => f.type !== 'number')]
  return ordered.slice(0, max).map((f) => f.name)
}

/**
 * Input for createPgSource().
 * @param {{connectionId:string, profile:object, strategy:string, geometryColumn?:string, h3Column?:string, valueColumn?:string, agg?:string, columns?:string[], name?:string}} o
 */
export function buildSourceInput({ connectionId, profile, strategy, geometryColumn, h3Column, valueColumn, agg, columns = [], name }) {
  const isH3 = strategy === 'h3cells' || strategy === 'h3aggregate'
  const geomInfo = (profile.geometry ?? []).find((g) => g.column === geometryColumn) ?? profile.geometry?.[0]
  const all = attributeColumns(profile)
  const chosen = isH3 ? [] : columns.filter((c) => all.some((f) => f.name === c))
  return {
    name: name?.trim() || `${profile.schema}.${profile.table}`,
    connectionId,
    schema: profile.schema,
    table: profile.table,
    strategy,
    geometryColumn: strategy === 'h3cells' ? undefined : geomInfo?.column,
    geometry: isH3 ? 'h3' : postgisGeometryClass(geomInfo?.type),
    columns: chosen,
    fields: all.filter((f) => chosen.includes(f.name)),
    h3: isH3 ? { column: strategy === 'h3cells' ? (h3Column ?? profile.h3?.[0]?.column) : undefined, valueColumn: valueColumn || undefined, agg: valueColumn ? (agg || 'avg') : 'count' } : undefined,
    extent: profile.extent?.bbox ?? null,
    estimatedRows: profile.estimatedRows ?? null,
  }
}
