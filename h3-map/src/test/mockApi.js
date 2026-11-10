// A mock of the FastAPI backend for tests (MSW). It enforces the bearer token like the real server, answers with
// the real error envelope, and records every request so tests can assert on what was (not) asked.
import { http, HttpResponse, delay } from 'msw'
import { setupServer } from 'msw/node'

export const TOKEN = 'test-token-123'
// jsdom serves pages from http://localhost:3000; its fetch resolves the app's relative `/api/v1` URLs against that origin.
export const API = `${globalThis.location?.origin ?? 'http://localhost:3000'}/api/v1`

export const CONNECTION = { id: 'anastasia', name: 'Anastasia (dev)', host: 'localhost', port: 5432, database: 'anastasia', username: 'gis_reader', sslmode: 'prefer', readOnly: true, source: 'env', status: 'unknown' }

const col = (name, type, extra = {}) => ({ name, type, nullable: true, isPrimaryKey: false, comment: null, ...extra })
const GIX = (name, column) => ({ name, method: 'gist', columns: [column], spatial: true, unique: false, primary: false })

const base = (table, rows, over) => ({
  schema: 'public', table, kind: 'table', estimatedRows: rows, exactRows: null, comment: null, primaryKey: ['id'],
  columns: [col('id', 'int8', { nullable: false, isPrimaryKey: true }), col('name', 'text'), col('pop', 'int4'), col('geom', 'geometry')],
  geometry: [{ column: 'geom', type: 'Polygon', srid: 4326, dims: 2, storage: 'geometry' }], h3: [],
  extent: { bbox: [34.2, 29.4, 35.9, 33.4], estimated: true }, indexes: [GIX(`${table}_gix`, 'geom')], recommendedStrategy: 'json', warnings: [], ...over,
})

export const PROFILES = {
  parcels: base('parcels', 1_250_000, { recommendedStrategy: 'mvt' }),
  poi: base('poi', 5_000, { geometry: [{ column: 'geom', type: 'Point', srid: 4326, dims: 2, storage: 'geometry' }], recommendedStrategy: 'json' }),
  events: base('events', 60_000, { geometry: [{ column: 'geom', type: 'Point', srid: 4326, dims: 2, storage: 'geometry' }], recommendedStrategy: 'bbox' }),
  big_points: base('big_points', 20_000_000, { geometry: [{ column: 'geom', type: 'Point', srid: 4326, dims: 2, storage: 'geometry' }], recommendedStrategy: 'aggregate' }),
  h3_pop: base('h3_pop', 220_000, {
    columns: [col('h3_index', 'int8', { nullable: false, isPrimaryKey: true }), col('population', 'int4')], primaryKey: ['h3_index'], geometry: [], indexes: [], extent: null,
    h3: [{ column: 'h3_index', storage: 'bigint', resolutions: [9], confidence: 0.99 }], recommendedStrategy: 'aggregate',
  }),
  unindexed: base('unindexed', 800, {
    indexes: [], recommendedStrategy: 'json',
    warnings: [{ code: 'no_spatial_index', column: 'geom', message: 'No spatial index on geom; bbox and tile queries will scan the whole table.', suggestion: 'CREATE INDEX "unindexed_geom_gix" ON "public"."unindexed" USING gist ("geom");' }],
  }),
  lookup: base('lookup', 40, { geometry: [], indexes: [], extent: null, recommendedStrategy: null, columns: [col('code', 'text'), col('label', 'text')], primaryKey: [] }),
}

export const TABLES = Object.values(PROFILES).map((p) => ({
  schema: 'public', name: p.table, kind: 'table', estimatedRows: p.estimatedRows, hasGeometry: p.geometry.length > 0, hasH3: p.h3.length > 0,
  geometryColumns: p.geometry.map((g) => ({ name: g.column, type: g.type, srid: g.srid })), comment: null,
}))

const envelope = (status, code, message, details = {}) => HttpResponse.json({ error: { code, message, details, requestId: 'req-1' } }, { status })

const feature = (id, lon, lat) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id, name: `poi ${id}`, pop: id * 10 } })

/**
 * @param {{ failTables?: boolean, dbDown?: boolean }} [flags] mutable switches tests flip at runtime
 */
export function createMockApi(flags = {}) {
  const calls = []
  const log = (request, extra = {}) => {
    const u = new URL(request.url)
    calls.push({ method: request.method, path: u.pathname.replace('/api/v1', ''), search: u.searchParams, auth: request.headers.get('Authorization'), ...extra })
  }
  const guard = (resolver) => async (info) => {
    log(info.request)
    if (info.request.headers.get('Authorization') !== `Bearer ${TOKEN}`) return envelope(401, 'unauthenticated', 'Missing or invalid token.')
    if (flags.dbDown && !/\/(connections|me|config)$/.test(new URL(info.request.url).pathname)) return envelope(502, 'db_unavailable', 'The database is not reachable.')
    return resolver(info)
  }
  const handlers = [
    http.post(`${API}/auth/login`, async ({ request }) => {
      log(request)
      const body = await request.json()
      if (body.username === 'admin' && body.password === 'right') return HttpResponse.json({ accessToken: TOKEN, tokenType: 'bearer', expiresIn: 3600, role: flags.role ?? 'admin' })
      return envelope(401, 'unauthenticated', 'Invalid username or password.')
    }),
    http.get(`${API}/me`, guard(() => HttpResponse.json({ user: 'admin', roles: [flags.role ?? 'admin'], settings: {} }))),
    http.get(`${API}/config`, guard(() => HttpResponse.json({
      version: '0.1.0', limits: { maxFeatures: 100000, defaultFeatures: 10000, maxFeaturesNoBbox: 50000, maxH3Cells: 250000, maxRowsLimit: 1000, tileFeatureCap: 50000 },
      thresholds: { json: 10000, bbox: 100000, mvt: 10000000 }, featureFlags: { arrow: true, userConnections: true },
    }))),
    http.get(`${API}/connections`, guard(() => HttpResponse.json([CONNECTION]))),
    http.get(`${API}/connections/:id/schemas`, guard(() => HttpResponse.json([{ name: 'public', tableCount: TABLES.length }]))),
    http.get(`${API}/connections/:id/schemas/:schema/tables`, guard(() => (flags.failTables ? envelope(500, 'internal_error', 'Internal error.') : HttpResponse.json(TABLES)))),
    http.get(`${API}/connections/:id/tables/:schema/:table/profile`, guard(({ params }) => (PROFILES[params.table] ? HttpResponse.json(PROFILES[params.table]) : envelope(404, 'not_found', 'The requested database object does not exist.')))),
    http.get(`${API}/connections/:id/tables/:schema/:table/rows`, guard(({ request }) => {
      const u = new URL(request.url)
      const offset = Number(u.searchParams.get('offset') ?? 0)
      const limit = Number(u.searchParams.get('limit') ?? 100)
      const rows = Array.from({ length: limit }, (_, i) => [offset + i + 1, `row ${offset + i + 1}`])
      return HttpResponse.json({ columns: [{ name: 'id', type: 'int8' }, { name: 'name', type: 'text' }], rows, page: { limit, offset, nextCursor: null, hasMore: offset + limit < 60 } })
    })),
    http.get(`${API}/connections/:id/tables/:schema/:table/features/:fid`, guard(({ params }) => HttpResponse.json({ ...feature(Number(params.fid), 2.3, 48.8), properties: { id: Number(params.fid), name: `poi ${params.fid}`, pop: 99, secret_column: 'full row' } }))),
    http.get(`${API}/connections/:id/tables/:schema/:table/features`, guard(async ({ request }) => {
      const u = new URL(request.url)
      if (flags.featureDelay) await delay(flags.featureDelay(u))
      const n = Number(flags.featureCount ?? 3)
      const features = Array.from({ length: n }, (_, i) => feature(i + 1, 2.2 + i * 0.01, 48.8))
      return HttpResponse.json({ type: 'FeatureCollection', features, page: { limit: 10000, nextCursor: null }, truncated: !!flags.truncated }, { headers: { 'X-Truncated': String(!!flags.truncated) } })
    })),
    http.post(`${API}/connections/:id/tiles/sessions`, guard(async ({ request }) => {
      const body = await request.json()
      calls[calls.length - 1].body = body
      return HttpResponse.json({ sessionId: `sess-${calls.filter((c) => c.method === 'POST' && c.path.endsWith('/tiles/sessions')).length}`, urlTemplate: '/api/v1/tiles/sess-1/{z}/{x}/{y}.mvt', bounds: [34.2, 29.4, 35.9, 33.4], minzoom: 0, maxzoom: 22, layer: 'layer', fields: { name: 'String', pop: 'Number' }, expiresAt: 0 }, { status: 201 })
    })),
    http.delete(`${API}/tiles/sessions/:sid`, guard(() => new HttpResponse(null, { status: 204 }))),
    http.get(`${API}/connections/:id/tables/:schema/:table/h3/cells`, guard(({ request }) => {
      const requested = Number(new URL(request.url).searchParams.get('resolution') ?? 8)
      const used = flags.coarsenTo ?? requested
      return HttpResponse.json({ resolution: used, requestedResolution: requested, nativeResolution: 9, coarsened: used < requested, truncated: false, cells: [{ h3: '8928308280fffff', value: 12.5, count: 4 }, { h3: '8928308280bffff', value: 3, count: 1 }], stats: { min: 3, max: 12.5, mean: 7.7, quantiles: {} } })
    })),
    http.get(`${API}/connections/:id/tables/:schema/:table/h3/aggregate`, guard(({ request }) => {
      const requested = Number(new URL(request.url).searchParams.get('resolution') ?? 8)
      return HttpResponse.json({ resolution: requested, requestedResolution: requested, coarsened: false, truncated: false, engine: 'python', cells: [{ h3: '8928308280fffff', value: 5, count: 5 }], stats: { min: 5, max: 5, mean: 5, quantiles: {} } })
    })),
    http.post(`${API}/connections/:id/test`, guard(() => HttpResponse.json({ ok: true, postgis: '3.4.2', h3Extension: false, serverVersion: 'PostgreSQL 16', latencyMs: 4.2 }))),
  ]
  return { handlers, calls, flags, reset: () => { calls.length = 0 } }
}

/** Start MSW. Unhandled requests fail the test instead of reaching a real server. */
export function startMockApi(flags) {
  const mock = createMockApi(flags)
  const server = setupServer(...mock.handlers)
  return {
    ...mock,
    server,
    listen: () => server.listen({ onUnhandledRequest: 'error' }),
    close: () => server.close(),
  }
}
