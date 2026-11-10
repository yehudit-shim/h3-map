import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { clearToken, setToken } from '../api/index.js'
import { TOKEN, PROFILES, startMockApi } from '../test/mockApi.js'
import { useDataStore } from '../state/dataStore.js'
import { buildSourceInput, defaultColumns, defaultLayerType, planStrategies } from './pgPlan.js'
import { checkTileUrl, createMvtUrlSource, createPgSource, fieldsFromColumns, openTileSessionCount, pgRefProblem, pgSourceRef, postgisGeometryClass, prunePgSources, releaseAllTileSessions, restorePgRef } from './pgSources.js'
import { getSource } from './sources.js'
import { buildDeckLayers } from '../layers/index.js'
import { createLayerConfig } from '../layers/layerFactory.js'

const mock = startMockApi()
beforeAll(() => mock.listen())
afterAll(() => mock.close())
beforeEach(() => {
  setToken(TOKEN, 3600)
  useDataStore.setState({ entries: {} })
})
afterEach(() => {
  prunePgSources([])
  mock.server.resetHandlers()
  mock.reset()
  Object.keys(mock.flags).forEach((k) => delete mock.flags[k])
  clearToken()
})

const make = (table, strategy, over = {}) =>
  createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES[table], strategy, columns: defaultColumns(PROFILES[table]), ...over }))

describe('strategy planning (the server recommendation is preselected)', () => {
  it.each([
    ['poi', 'json'],
    ['events', 'bbox'],
    ['parcels', 'mvt'],
    ['big_points', 'h3aggregate'], // the server says "aggregate" for a 20M-row point table
    ['h3_pop', 'h3cells'], // ... and for a table that only has an H3 column
  ])('%s -> %s', (table, expected) => {
    const plan = planStrategies(PROFILES[table])
    expect(plan.default).toBe(expected)
    expect(plan.options.find((o) => o.strategy === expected).recommended).toBe(true)
  })

  it('offers nothing for a table without geometry or H3, and warns about whole-table loads of big tables', () => {
    expect(planStrategies(PROFILES.lookup)).toMatchObject({ options: [], default: null })
    expect(planStrategies(PROFILES.parcels).options.find((o) => o.strategy === 'json').warning).toMatch(/1,250,000/)
    expect(planStrategies(PROFILES.poi).options.find((o) => o.strategy === 'json').warning).toBeUndefined()
  })

  it('maps strategies to layer types and geometry classes', () => {
    expect(defaultLayerType('mvt', 'polygon')).toBe('mvt')
    expect(defaultLayerType('h3cells', 'h3')).toBe('h3cells')
    expect(defaultLayerType('bbox', 'point')).toBe('point')
    expect(defaultLayerType('json', 'mixed')).toBe('geojson')
    expect(['MultiPolygon', 'Polygon', 'MultiPoint', 'LineString', 'Geometry'].map(postgisGeometryClass)).toEqual(['polygon', 'polygon', 'point', 'line', 'mixed'])
    expect(fieldsFromColumns(PROFILES.poi.columns)).toEqual([{ name: 'id', type: 'number' }, { name: 'name', type: 'string' }, { name: 'pop', type: 'number' }])
  })
})

describe('bbox source', () => {
  it('requests the viewport with zoom and automatic simplification and reports truncation', async () => {
    mock.flags.truncated = true
    const source = make('events', 'bbox')
    expect(source.dynamic).toBe(true)
    await useDataStore.getState().loadView(source.id, { bbox: [2.2, 48.8, 2.4, 48.9], zoom: 12.4, limit: 5000 })
    const call = mock.calls.find((c) => c.path.endsWith('/features'))
    expect(Object.fromEntries(call.search)).toMatchObject({ bbox: '2.2,48.8,2.4,48.9', zoom: '12.4', simplify: 'auto', limit: '5000', geometryColumn: 'geom' })
    expect(call.search.get('columns')).toContain('pop')
    expect(useDataStore.getState().entries[source.id]).toMatchObject({ status: 'ready', featureCount: 3, truncated: true, unit: 'features' })
  })

  it('needs a sign-in rather than calling the API without a token', async () => {
    clearToken()
    const source = make('events', 'bbox')
    await useDataStore.getState().loadView(source.id, { bbox: [0, 0, 1, 1] })
    expect(useDataStore.getState().entries[source.id]).toMatchObject({ status: 'error', needsAuth: true })
    expect(mock.calls).toHaveLength(0)
  })

  it('a missing table is a "reconnect" state, not a crash', async () => {
    const source = createPgSource({ ...buildSourceInput({ connectionId: 'anastasia', profile: PROFILES.poi, strategy: 'bbox' }), table: 'dropped_table' })
    const { http, HttpResponse } = await import('msw')
    mock.server.use(http.get(/\/features$/, () => HttpResponse.json({ error: { code: 'not_found', message: 'The requested database object does not exist.', details: {}, requestId: 'r' } }, { status: 404 })))
    await useDataStore.getState().loadView(source.id, { bbox: [0, 0, 1, 1] })
    const e = useDataStore.getState().entries[source.id]
    expect(e).toMatchObject({ status: 'error', needsReconnect: true })
    expect(e.error).toMatch(/Reconnect/i)
  })
})

describe('MVT source', () => {
  it('creates a tile session, hands layers the token through headers (never the URL) and deletes the session on removal', async () => {
    const source = make('parcels', 'mvt')
    await useDataStore.getState().load(source.id)
    const entry = useDataStore.getState().entries[source.id]
    expect(entry.status).toBe('ready')
    const body = mock.calls.find((c) => c.path.endsWith('/tiles/sessions')).body
    expect(body).toMatchObject({ schema: 'public', table: 'parcels', geometryColumn: 'geom', minzoom: 0, maxzoom: 22 })
    expect(entry.data.urlTemplate).not.toContain(TOKEN)
    expect(entry.data.getHeaders()).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(openTileSessionCount()).toBe(1)

    // the layer type receives the headers via loadOptions and the URL has no credentials
    const cfg = createLayerConfig('mvt', source.id)
    const { layers, errors } = buildDeckLayers([cfg], useDataStore.getState().entries, { autoResolution: 8, selection: null })
    expect(errors).toEqual([])
    expect(layers[0].props.loadOptions.fetch.headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(layers[0].props.data).toBe('/api/v1/tiles/sess-1/{z}/{x}/{y}.mvt')

    // removing the layer (source no longer used) releases the server-side session
    mock.reset()
    prunePgSources([])
    await new Promise((r) => setTimeout(r, 30))
    expect(mock.calls.some((c) => c.method === 'DELETE' && c.path === '/tiles/sessions/sess-1')).toBe(true)
    expect(openTileSessionCount()).toBe(0)
  })

  it('sign-out deletes every open session', async () => {
    const source = make('parcels', 'mvt')
    await useDataStore.getState().load(source.id)
    mock.reset()
    await releaseAllTileSessions()
    expect(mock.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  })

  it('fetches the full feature by id for the inspector', async () => {
    const source = make('parcels', 'mvt')
    const f = await source.fetchFeature(42)
    expect(f.properties).toMatchObject({ id: 42, secret_column: 'full row' })
    expect(mock.calls.at(-1).path).toBe('/connections/anastasia/tables/public/parcels/features/42')
  })

  it('a public MVT URL is a second source: no token, validated URL', async () => {
    expect(checkTileUrl('https://tiles.example.com/{z}/{x}/{y}.pbf')).toBeNull()
    expect(checkTileUrl('https://tiles.example.com/tiles.pbf')).toMatch(/\{z\}/)
    expect(checkTileUrl('ftp://x/{z}/{x}/{y}')).toMatch(/http/)
    expect(() => createMvtUrlSource({ url: 'nope' })).toThrow()
    const s = createMvtUrlSource({ url: 'https://tiles.example.com/{z}/{x}/{y}.pbf', name: 'Public' })
    await useDataStore.getState().load(s.id)
    const data = useDataStore.getState().entries[s.id].data
    expect(data.getHeaders()).toEqual({}) // no Authorization towards a third party
    expect(mock.calls).toHaveLength(0)
  })
})

describe('H3 sources', () => {
  it('asks /h3/cells for an existing H3 table with the requested resolution and reports a coarser result', async () => {
    mock.flags.coarsenTo = 6
    const source = make('h3_pop', 'h3cells', { valueColumn: 'population', agg: 'sum' })
    await useDataStore.getState().loadView(source.id, { bbox: [34, 29, 36, 33], resolution: 8, limit: 250000 })
    const call = mock.calls.find((c) => c.path.endsWith('/h3/cells'))
    expect(Object.fromEntries(call.search)).toMatchObject({ column: 'h3_index', resolution: '8', value: 'population', agg: 'sum', maxCells: '250000' })
    const e = useDataStore.getState().entries[source.id]
    expect(e).toMatchObject({ status: 'ready', unit: 'cells', featureCount: 2 })
    expect(e.notice).toMatch(/resolution 6 instead of 8/)
    expect(e.data).toMatchObject({ resolution: 6, requested: 8, coarsened: true })
  })

  it('aggregates a point table with /h3/aggregate and no notice when the resolution is honoured', async () => {
    const source = make('big_points', 'h3aggregate')
    await useDataStore.getState().loadView(source.id, { bbox: [34, 29, 36, 33], resolution: 7 })
    expect(mock.calls.some((c) => c.path.endsWith('/h3/aggregate') && c.search.get('resolution') === '7' && c.search.get('geometryColumn') === 'geom')).toBe(true)
    expect(useDataStore.getState().entries[source.id].notice).toBeNull()
  })

  it('the h3cells layer draws the cells and describes them', async () => {
    const source = make('h3_pop', 'h3cells')
    await useDataStore.getState().loadView(source.id, { bbox: [34, 29, 36, 33], resolution: 9 })
    const cfg = createLayerConfig('h3cells', source.id)
    const { layers, prepared } = buildDeckLayers([cfg], useDataStore.getState().entries, { autoResolution: 9, selection: null })
    expect(layers).toHaveLength(1)
    expect(prepared[cfg.id]).toMatchObject({ resolution: 9, requested: 9 })
  })
})

describe('saved references hold no secrets', () => {
  it('serialises only a whitelist of ids and names', () => {
    const source = make('events', 'bbox')
    // anything extra that ended up on the source object must not reach the reference
    Object.assign(source, { token: 'leak', password: 'leak', sessionId: 'leak', headers: { Authorization: 'leak' }, host: 'db.internal' })
    const ref = pgSourceRef(source)
    expect(Object.keys(ref).sort()).toEqual(['columns', 'connectionId', 'estimatedRows', 'extent', 'fields', 'geometry', 'geometryColumn', 'id', 'kind', 'name', 'schema', 'strategy', 'table'])
    const json = JSON.stringify(ref)
    expect(json).not.toMatch(/leak|db\.internal|Bearer|test-token/)
  })

  it('restores valid references, skips invalid ones and keeps what is registered in this session', () => {
    const ref = pgSourceRef(make('poi', 'json'))
    prunePgSources([])
    expect(getSource(ref.id)).toBeUndefined()
    expect(pgRefProblem(ref)).toBeNull()
    restorePgRef(ref)
    expect(getSource(ref.id)).toMatchObject({ kind: 'postgis', strategy: 'json', table: 'poi', dataKind: 'features' })
    expect(pgRefProblem({ ...ref, strategy: 'raw_sql' })).toMatch(/strategy/)
    expect(pgRefProblem({ ...ref, connectionId: '' })).toMatch(/connection/)
    expect(pgRefProblem({ ...ref, geometry: 'blob' })).toMatch(/geometry/)
    expect(pgRefProblem({ kind: 'mvt', id: 'x', url: 'javascript:alert(1)' })).toMatch(/URL/)
  })
})
