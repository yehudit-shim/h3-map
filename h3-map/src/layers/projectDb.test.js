// Schema 3: database and MVT sources in projects, the v2 -> v3 migration, and "reconnect" on import.
import { afterEach, describe, expect, it } from 'vitest'
import { buildSourceInput } from '../data/pgPlan.js'
import { createMvtUrlSource, createPgSource, prunePgSources } from '../data/pgSources.js'
import { getSource } from '../data/sources.js'
import { PROFILES } from '../test/mockApi.js'
import { PROJECT_FORMAT, SCHEMA_VERSION, migrateProject, readProject, serializeProject } from './project.js'
import './index.js' // registers the built-in layer types
import { createLayerConfig } from './layerFactory.js'

afterEach(() => prunePgSources([]))

const pg = (table, strategy) => createPgSource(buildSourceInput({ connectionId: 'anastasia', profile: PROFILES[table], strategy, columns: ['pop'] }))

describe('project schema 3', () => {
  it('migrates a v2 project (files, URLs, web layers) without touching it', () => {
    expect(SCHEMA_VERSION).toBe(3)
    const layer = createLayerConfig('point', 'sample-pois')
    const v2 = { format: PROJECT_FORMAT, schemaVersion: 2, layers: [layer], sources: [] }
    const m = migrateProject(v2)
    expect(m).toMatchObject({ schemaVersion: 3, sources: [] })
    expect(m.layers).toEqual([layer])
    const { tree, problems } = readProject(v2)
    expect(problems).toEqual([])
    expect(tree).toEqual([layer])
  })

  it('rejects a project from a newer app version', () => {
    expect(() => migrateProject({ format: PROJECT_FORMAT, schemaVersion: 4, layers: [] })).toThrow(/newer/)
  })

  it('round-trips database layers as a connection id and table reference only', () => {
    const bbox = pg('events', 'bbox')
    const mvt = pg('parcels', 'mvt')
    const h3 = pg('h3_pop', 'h3cells')
    const url = createMvtUrlSource({ url: 'https://tiles.example.com/{z}/{x}/{y}.pbf', name: 'Public tiles' })
    const layers = [
      createLayerConfig('point', bbox.id, { name: 'Events' }),
      createLayerConfig('mvt', mvt.id, { name: 'Parcels' }),
      createLayerConfig('h3cells', h3.id, { name: 'Population' }),
      createLayerConfig('mvt', url.id, { name: 'Public' }),
    ]
    const file = serializeProject(layers)
    expect(file.schemaVersion).toBe(3)
    expect(file.sources.map((s) => s.kind).sort()).toEqual(['mvt', 'postgis', 'postgis', 'postgis'])
    const text = JSON.stringify(file)
    // the export names the connection by id and contains nothing that could authenticate
    expect(text).toContain('"connectionId":"anastasia"')
    expect(text).not.toMatch(/token|password|secret|Bearer|sessionId|urlTemplate|authorization/i)

    prunePgSources([]) // a fresh session: nothing registered
    const { tree, problems } = readProject(text)
    expect(problems).toEqual([])
    expect(tree.map((l) => [l.name, l.type, getSource(l.sourceId).kind])).toEqual([['Events', 'point', 'postgis'], ['Parcels', 'mvt', 'postgis'], ['Population', 'h3cells', 'postgis'], ['Public', 'mvt', 'mvt']])
    expect(getSource(tree[1].sourceId)).toMatchObject({ strategy: 'mvt', schema: 'public', table: 'parcels', dataKind: 'tiles' })
  })

  it('drops tampered references (unknown strategy, bad URL) with a message, and ignores extra keys', () => {
    const src = pg('poi', 'json')
    const layer = createLayerConfig('point', src.id)
    const file = serializeProject([layer])
    prunePgSources([])
    file.sources = [
      { ...file.sources[0], token: 'abc', password: 'p', host: 'evil.example' },
      { kind: 'postgis', id: 'bad-1', connectionId: 'c', schema: 's', table: 't', strategy: 'sql', geometry: 'point' },
      { kind: 'mvt', id: 'bad-2', url: 'javascript:alert(1)' },
    ]
    const { problems } = readProject(file)
    expect(problems.filter((p) => /database source/.test(p))).toHaveLength(2)
    const restored = getSource(src.id)
    expect(restored).toBeDefined()
    expect(restored.token).toBeUndefined()
    expect(restored.password).toBeUndefined()
    expect(restored.host).toBeUndefined()
    expect(getSource('bad-1')).toBeUndefined()
  })

  it('a layer whose source reference is unusable is dropped with an explanation, never a crash', () => {
    const src = pg('poi', 'json')
    const layer = createLayerConfig('point', src.id)
    const file = serializeProject([layer])
    prunePgSources([])
    file.sources = []
    const { tree, problems } = readProject(file)
    expect(tree).toEqual([])
    expect(problems.join(' ')).toMatch(/unknown data source/)
  })

  it('a layer type cannot be paired with a source it does not understand', () => {
    const tiles = pg('parcels', 'mvt')
    expect(() => createLayerConfig('polygon', tiles.id)).toThrow(/cannot draw/)
    const feats = pg('poi', 'json')
    expect(() => createLayerConfig('mvt', feats.id)).toThrow(/cannot draw/)
  })
})
