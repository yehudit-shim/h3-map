// Data sources backed by the FastAPI/PostGIS backend (Phase 6B), plus public MVT URLs.
//
// A source describes *where data comes from*; the layer types only ever see its output:
//   strategy 'json'      one request for the whole table            -> GeoJSON            (dataKind 'features')
//   strategy 'bbox'      one request per viewport (source.dynamic)  -> GeoJSON + truncated (dataKind 'features')
//   strategy 'mvt'       a tile session on the server               -> tile descriptor    (dataKind 'tiles')
//   strategy 'h3cells'   /h3/cells of an existing H3 table          -> {cells,...}        (dataKind 'h3cells')
//   strategy 'h3aggregate' /h3/aggregate of a point table           -> {cells,...}        (dataKind 'h3cells')
//
// Persistence rule: a saved project keeps only a REFERENCE (connection id, schema, table, strategy, column names).
// No token, password, host, session id or data is ever part of it; `pgSourceRef` copies an explicit whitelist.
import {
  createTileSession, deleteTileSession, getFeature, getFeatures, getH3Aggregate, getH3Cells, getToken, api, tileUrl,
} from '../api/index.js'
import { createId } from '../lib/ids.js'
import { dataSources, getSource, registerSource, unregisterSource } from './sources.js'

export const PG_STRATEGIES = ['json', 'bbox', 'mvt', 'h3cells', 'h3aggregate']
export const STRATEGY_LABELS = {
  json: 'GeoJSON (whole table)',
  bbox: 'GeoJSON (viewport)',
  mvt: 'Vector tiles (MVT)',
  h3cells: 'H3 cells (existing H3 table)',
  h3aggregate: 'H3 aggregate (from points)',
}
const GEOMETRIES = ['point', 'line', 'polygon', 'mixed', 'h3']
const AGGS = ['count', 'sum', 'avg', 'min', 'max', 'median']

export const isPgSource = (s) => s?.kind === 'postgis'
export const isMvtUrlSource = (s) => s?.kind === 'mvt'
/** Sources that are saved as a reference in projects (everything that is not bundled sample data). */
export const isTileOrPgSource = (s) => isPgSource(s) || isMvtUrlSource(s)

/** The user must sign in before this source can load. */
export class NeedsAuthError extends Error {
  constructor() {
    super('Sign in to load this database layer.')
    this.name = 'NeedsAuthError'
    this.code = 'needs-auth'
  }
}

// ---- helpers shared with the add-to-map dialog ----------------------------------------------------

/** PostGIS geometry type name -> the geometry class layer types are declared for. */
export function postgisGeometryClass(type) {
  const t = String(type ?? '').toLowerCase()
  if (t.endsWith('point')) return 'point'
  if (t.endsWith('linestring')) return 'line'
  if (t.endsWith('polygon')) return 'polygon'
  return 'mixed'
}

const NUMERIC = /^(int\d?|integer|bigint|smallint|serial\d?|bigserial|float\d?|double|real|numeric|decimal|money|oid)\b|^(int|float)\d+$/i
const NOT_ATTRIBUTE = /geometry|geography|bytea|h3index|raster|tsvector|xml/i

/** Column descriptors from the profile -> field metadata for styling (`{name,type:'number'|'string'}`). */
export function fieldsFromColumns(columns) {
  return (columns ?? [])
    .filter((c) => c?.name && !NOT_ATTRIBUTE.test(String(c.type)))
    .map((c) => ({ name: c.name, type: NUMERIC.test(String(c.type)) ? 'number' : 'string' }))
}

export const dataKindOf = (strategy) => (strategy === 'mvt' ? 'tiles' : strategy === 'h3cells' || strategy === 'h3aggregate' ? 'h3cells' : 'features')

// ---- tile sessions ---------------------------------------------------------------------------------
const sessions = new Map() // sourceId -> sessionId (so removing the layer can delete the server-side session)

async function releaseSession(sourceId) {
  const sid = sessions.get(sourceId)
  if (!sid) return
  sessions.delete(sourceId)
  try {
    if (getToken()) await deleteTileSession(sid)
  } catch {
    // best effort: the server also expires sessions on its own
  }
}

/** Delete every open tile session (sign-out). */
export async function releaseAllTileSessions() {
  await Promise.all([...sessions.keys()].map(releaseSession))
}

export const openTileSessionCount = () => sessions.size

// ---- source construction ---------------------------------------------------------------------------

/**
 * @param {object} meta reference fields (see pgSourceRef) incl. id
 */
function buildPgSource(meta) {
  const { strategy } = meta
  const dataKind = dataKindOf(strategy)
  const where = `${meta.schema}.${meta.table}`
  const source = {
    ...meta,
    kind: 'postgis',
    dataKind,
    // Bbox and H3 sources are re-requested for the viewport by map/useViewportSources.js (load() needs {bbox}).
    dynamic: strategy === 'bbox' || strategy === 'h3cells' || strategy === 'h3aggregate',
    bounds: meta.extent ?? null,
    description: `${STRATEGY_LABELS[strategy]} · ${where}`,

    async load({ bbox, zoom, resolution, limit, signal } = {}) {
      if (!getToken()) throw new NeedsAuthError()
      const base = { signal }
      if (strategy === 'json' || strategy === 'bbox') {
        if (strategy === 'bbox' && !bbox) throw new Error('A viewport is needed to load this layer.')
        const fc = await getFeatures(meta.connectionId, meta.schema, meta.table, {
          ...base,
          bbox,
          geometryColumn: meta.geometryColumn,
          columns: meta.columns,
          zoom: strategy === 'bbox' ? zoom : undefined,
          simplify: strategy === 'bbox' ? 'auto' : undefined,
          limit,
        })
        return { ...fc, features: Array.isArray(fc.features) ? fc.features : [], truncated: fc.truncated === true }
      }
      if (strategy === 'mvt') {
        const s = await createTileSession(meta.connectionId, {
          schema: meta.schema,
          table: meta.table,
          geometryColumn: meta.geometryColumn,
          columns: meta.columns,
          minzoom: 0,
          maxzoom: 22,
        }, base)
        // Replace a previous session of this source (retry): never leak one.
        await releaseSession(meta.id)
        sessions.set(meta.id, s.sessionId)
        return { tiles: true, urlTemplate: tileUrl(s.urlTemplate), minzoom: s.minzoom, maxzoom: s.maxzoom, bounds: s.bounds, sourceLayer: s.layer ?? 'layer', authenticated: true, getHeaders: () => api.authHeaders() }
      }
      // H3 from the database
      const h3 = meta.h3 ?? {}
      const q = { ...base, resolution, bbox, value: h3.valueColumn, agg: h3.agg, maxCells: limit }
      const res = strategy === 'h3cells'
        ? await getH3Cells(meta.connectionId, meta.schema, meta.table, { ...q, column: h3.column })
        : await getH3Aggregate(meta.connectionId, meta.schema, meta.table, { ...q, geometryColumn: meta.geometryColumn })
      return {
        cells: Array.isArray(res.cells) ? res.cells : [],
        resolution: res.resolution,
        requested: res.requestedResolution ?? resolution,
        coarsened: res.coarsened === true || (resolution != null && res.resolution < resolution),
        truncated: res.truncated === true,
        stats: res.stats ?? null,
      }
    },

    /** What the entry shows next to the layer (count, truncation, coarser-resolution notice). */
    summarize(data) {
      if (dataKind === 'features') return { count: data.features.length, unit: 'features', truncated: data.truncated === true }
      if (dataKind === 'h3cells') {
        const notice = data.coarsened ? `Showing H3 resolution ${data.resolution} instead of ${data.requested}: the server returned a coarser grid to stay within its cell limit. Zoom in for finer cells.` : null
        return { count: data.cells.length, unit: 'cells', truncated: data.truncated === true, notice }
      }
      return { count: null }
    },

    /** Full attributes of one feature (after a click on a tile). */
    fetchFeature: (id, { signal } = {}) => getFeature(meta.connectionId, meta.schema, meta.table, id, { geometryColumn: meta.geometryColumn, signal }),

    dispose: () => releaseSession(meta.id),
  }
  return source
}

/** Create and register a source for a table the user added from the database browser. */
export function createPgSource(input) {
  const source = buildPgSource({
    id: createId('pg'),
    name: input.name,
    connectionId: input.connectionId,
    schema: input.schema,
    table: input.table,
    strategy: input.strategy,
    geometryColumn: input.geometryColumn,
    geometry: input.geometry,
    fields: input.fields ?? [],
    columns: input.columns ?? [],
    h3: input.h3,
    extent: input.extent ?? null,
    estimatedRows: input.estimatedRows ?? null,
  })
  return registerSource(source)
}

// ---- public MVT URL ----------------------------------------------------------------------------------

/** `https://host/{z}/{x}/{y}.pbf` -> null when fine, else the problem. */
export function checkTileUrl(url) {
  let u
  try {
    u = new URL(String(url).replace(/\{[xyz]\}/g, '0'))
  } catch {
    return 'Enter a valid URL.'
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Only http(s) URLs are supported.'
  for (const t of ['{z}', '{x}', '{y}']) if (!String(url).includes(t)) return `The URL must contain ${t}.`
  return null
}

function buildMvtUrlSource(meta) {
  return {
    ...meta,
    kind: 'mvt',
    dataKind: 'tiles',
    strategy: 'mvt',
    description: `Public vector tiles · ${meta.url}`,
    bounds: null,
    async load() {
      return { tiles: true, urlTemplate: meta.url, minzoom: meta.minzoom, maxzoom: meta.maxzoom, bounds: null, sourceLayer: meta.sourceLayer ?? null, authenticated: false, getHeaders: () => ({}) }
    },
    summarize: () => ({ count: null }),
  }
}

/** @param {{name:string, url:string, sourceLayer?:string, minzoom?:number, maxzoom?:number, geometry?:string, fields?:object[]}} input */
export function createMvtUrlSource(input) {
  const problem = checkTileUrl(input.url)
  if (problem) throw new Error(problem)
  return registerSource(buildMvtUrlSource({
    id: createId('mvt'),
    name: input.name?.trim() || new URL(input.url.replace(/\{[xyz]\}/g, '0')).hostname,
    url: input.url.trim(),
    sourceLayer: input.sourceLayer?.trim() || undefined,
    minzoom: clampInt(input.minzoom, 0, 24, 0),
    maxzoom: clampInt(input.maxzoom, 0, 24, 14),
    geometry: GEOMETRIES.includes(input.geometry) ? input.geometry : 'mixed',
    fields: (input.fields ?? []).map((f) => ({ name: f.name, type: f.type === 'number' ? 'number' : 'string' })),
  }))
}

const clampInt = (v, lo, hi, fallback) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : fallback)

// ---- references (what a project / localStorage keeps) -----------------------------------------------

/** Serialisable reference. An explicit whitelist: nothing else on the source (sessions, headers, data) can leak in. */
export function pgSourceRef(source) {
  const fields = (source.fields ?? []).map((f) => ({ name: f.name, type: f.type }))
  if (source.kind === 'mvt') {
    const ref = { id: source.id, kind: 'mvt', name: source.name, url: source.url, minzoom: source.minzoom, maxzoom: source.maxzoom, geometry: source.geometry, fields }
    if (source.sourceLayer) ref.sourceLayer = source.sourceLayer
    return ref
  }
  const ref = {
    id: source.id, kind: 'postgis', name: source.name, connectionId: source.connectionId, schema: source.schema, table: source.table,
    strategy: source.strategy, geometry: source.geometry, fields, columns: [...(source.columns ?? [])],
  }
  if (source.geometryColumn) ref.geometryColumn = source.geometryColumn
  if (source.h3) ref.h3 = pick(source.h3, ['column', 'valueColumn', 'agg'])
  if (isBbox(source.extent)) ref.extent = [...source.extent]
  if (Number.isFinite(source.estimatedRows)) ref.estimatedRows = source.estimatedRows
  return ref
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] != null).map((k) => [k, o[k]]))
const str = (v) => typeof v === 'string' && v.trim() !== ''
const isBbox = (b) => Array.isArray(b) && b.length === 4 && b.every((v) => typeof v === 'number' && Number.isFinite(v))
const cleanFields = (f) => (Array.isArray(f) ? f : []).filter((x) => x && str(x.name) && (x.type === 'number' || x.type === 'string')).map((x) => ({ name: x.name, type: x.type }))

/** Why a saved reference is unusable, or null. */
export function pgRefProblem(r) {
  if (!r || typeof r !== 'object') return 'not an object'
  if (!str(r.id)) return 'missing id'
  if (r.kind === 'mvt') {
    if (!str(r.url) || checkTileUrl(r.url)) return 'invalid tile URL'
    return null
  }
  if (r.kind !== 'postgis') return `unknown kind "${r.kind}"`
  if (!str(r.connectionId) || !str(r.schema) || !str(r.table)) return 'missing connection or table'
  if (!PG_STRATEGIES.includes(r.strategy)) return `unknown strategy "${r.strategy}"`
  if (!GEOMETRIES.includes(r.geometry)) return `unknown geometry "${r.geometry}"`
  if (r.h3 && r.h3.agg && !AGGS.includes(r.h3.agg)) return 'invalid H3 aggregation'
  return null
}

/** Register a saved reference (already validated by pgRefProblem). A source registered in this session is kept. */
export function restorePgRef(r) {
  if (getSource(r.id)) return
  if (r.kind === 'mvt') {
    registerSource(buildMvtUrlSource({
      id: r.id, name: str(r.name) ? r.name : 'Vector tiles', url: r.url, sourceLayer: str(r.sourceLayer) ? r.sourceLayer : undefined,
      minzoom: clampInt(r.minzoom, 0, 24, 0), maxzoom: clampInt(r.maxzoom, 0, 24, 14), geometry: r.geometry ?? 'mixed', fields: cleanFields(r.fields),
    }))
    return
  }
  registerSource(buildPgSource({
    id: r.id, name: str(r.name) ? r.name : `${r.schema}.${r.table}`, connectionId: r.connectionId, schema: r.schema, table: r.table,
    strategy: r.strategy, geometry: r.geometry, geometryColumn: str(r.geometryColumn) ? r.geometryColumn : undefined,
    fields: cleanFields(r.fields), columns: (Array.isArray(r.columns) ? r.columns : []).filter(str),
    h3: r.h3 ? pick(r.h3, ['column', 'valueColumn', 'agg']) : undefined,
    extent: isBbox(r.extent) ? r.extent : null, estimatedRows: Number.isFinite(r.estimatedRows) ? r.estimatedRows : null,
  }))
}

/** Unregister database / MVT sources no layer uses any more (and release their tile sessions). Returns the removed ids. */
export function prunePgSources(usedIds) {
  const used = new Set(usedIds)
  const removed = dataSources.filter((s) => isTileOrPgSource(s) && !used.has(s.id))
  for (const s of removed) {
    unregisterSource(s.id)
    s.dispose?.()
  }
  return removed.map((s) => s.id)
}
