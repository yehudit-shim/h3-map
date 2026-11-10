import { afterEach, describe, expect, it } from 'vitest'
import { createLayerConfig } from './index.js'
import { PROJECT_FORMAT, SCHEMA_VERSION, migrateProject, readProject, sanitizeTree, serializeProject } from './project.js'
import { getSource } from '../data/sources.js'
import { createUserSource, pruneUserSources } from '../data/userSources.js'
import { createGroup } from './tree.js'

describe('project files', () => {
  it('round-trips a tree with groups and independent styles', () => {
    const a = createLayerConfig('point', 'sample-pois', { name: 'A', style: { radius: 12 } })
    const b = createLayerConfig('polygon', 'sample-districts', { name: 'B', opacity: 0.4, style: { extruded: true } })
    const tree = [createGroup('G', [a]), b]
    const file = JSON.parse(JSON.stringify(serializeProject(tree)))
    expect(file.format).toBe(PROJECT_FORMAT)
    expect(file.schemaVersion).toBe(SCHEMA_VERSION)
    const { tree: back, problems } = readProject(JSON.stringify(file))
    expect(problems).toEqual([])
    expect(back).toEqual(tree)
  })

  it('migrates the Phase 1-2 flat layer list (schema 0)', () => {
    const legacy = createLayerConfig('line', 'sample-routes')
    delete legacy.kind
    const { tree } = readProject({ schemaVersion: 0, layers: [legacy] })
    expect(tree[0].kind).toBe('layer')
    expect(migrateProject([legacy]).layers[0].kind).toBe('layer')
  })

  it('rejects other formats and newer schema versions', () => {
    expect(() => readProject({ format: 'other', layers: [] })).toThrow(/Unsupported/)
    expect(() => readProject({ schemaVersion: SCHEMA_VERSION + 1, layers: [] })).toThrow(/newer/)
    expect(() => readProject('not json')).toThrow()
    expect(() => readProject({ schemaVersion: 1 })).toThrow(/no "layers"/)
  })

  it('drops invalid layers, fills new style defaults, clamps values and de-duplicates ids', () => {
    const ok = createLayerConfig('point', 'sample-pois')
    const { tree, problems } = sanitizeTree([
      { ...ok, opacity: 7, style: { radius: 3 } }, // style keys missing -> defaults
      { ...ok }, // same id
      { kind: 'layer', id: 'x', type: 'nope', sourceId: 'sample-pois' },
      { kind: 'layer', id: 'y', type: 'h3', sourceId: 'sample-routes' },
      { kind: 'layer', id: 'z', type: 'point', sourceId: 'missing' },
      42,
    ])
    expect(tree).toHaveLength(2)
    expect(problems).toHaveLength(4)
    expect(tree[0].opacity).toBe(1)
    expect(tree[0].style.radius).toBe(3)
    expect(tree[0].style.fillColor).toBe(ok.style.fillColor)
    expect(tree[1].id).not.toBe(tree[0].id)
  })
})

describe('project schema 2: user sources and web layers', () => {
  const geo = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { v: 1 }, geometry: { type: 'Point', coordinates: [2, 48] } }] }
  const result = { data: geo, fields: [{ name: 'v', type: 'number' }], geometry: 'point', featureCount: 1 }

  afterEach(() => pruneUserSources([]))

  it('is version 3 and migrates v1 projects (no sources) unchanged', () => {
    expect(SCHEMA_VERSION).toBe(3)
    const layer = createLayerConfig('point', 'sample-pois')
    const m = migrateProject({ format: PROJECT_FORMAT, schemaVersion: 1, layers: [layer] })
    expect(m.schemaVersion).toBe(3)
    expect(m.sources).toEqual([])
    expect(readProject({ schemaVersion: 1, layers: [layer] }).tree).toEqual([layer])
  })

  it('round-trips sourceless layers with sourceId null', () => {
    const xyz = createLayerConfig('xyz', null, { opacity: 0.5, style: { attribution: '© me' } })
    const wms = createLayerConfig('wms', null, { style: { url: 'https://example.com/wms', layers: 'a' } })
    const { tree, problems } = readProject(JSON.stringify(serializeProject([xyz, wms])))
    expect(problems).toEqual([])
    expect(tree).toEqual([xyz, wms])
    expect(tree.every((l) => l.sourceId === null)).toBe(true)
  })

  it('drops web layers with an unusable URL or no WMS layer names, and forces sourceId null', () => {
    const xyz = createLayerConfig('xyz', null)
    const { tree, problems } = sanitizeTree([
      { ...xyz, sourceId: 'sample-pois' },
      { ...xyz, id: 'bad1', style: { url: 'javascript:alert(1)' } },
      { ...xyz, id: 'bad2', style: { url: 'https://t.example/tiles.png' } },
      createLayerConfig('wms', null),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].sourceId).toBeNull()
    expect(problems).toHaveLength(3)
  })

  it('saves a file layer as a reference only and restores it needing the file', () => {
    const source = createUserSource({ format: 'geojson', origin: 'file', name: 'pts', fileName: 'pts.geojson' }, result)
    const layer = createLayerConfig('point', source.id, { style: { radius: 9 } })
    const text = JSON.stringify(serializeProject([layer]))
    expect(text).not.toMatch(/"coordinates"|FeatureCollection/)
    expect(JSON.parse(text).sources).toHaveLength(1)

    pruneUserSources([]) // new session: nothing registered
    const { tree, problems } = readProject(text)
    expect(problems).toEqual([])
    expect(tree[0].style.radius).toBe(9)
    expect(getSource(source.id).needsFile).toBe(true)
  })

  it('restores a URL layer that reloads itself, and drops layers whose source reference is missing', () => {
    const source = createUserSource({ format: 'geojson', origin: 'url', name: 'remote', url: 'https://example.com/a.geojson' }, result)
    const layer = createLayerConfig('point', source.id)
    const file = JSON.parse(JSON.stringify(serializeProject([layer])))
    expect(file.sources[0]).toMatchObject({ kind: 'url', url: 'https://example.com/a.geojson' })
    pruneUserSources([])
    expect(readProject(file).tree).toHaveLength(1)
    pruneUserSources([])
    const { tree, problems } = readProject({ ...file, sources: [] })
    expect(tree).toEqual([])
    expect(problems[0]).toMatch(/unknown data source/)
  })

  it('reports invalid source references and ignores a sources list in old files', () => {
    const { problems } = readProject({ schemaVersion: 2, layers: [], sources: [{ id: 'x' }] })
    expect(problems[0]).toMatch(/Skipped a saved data source/)
    expect(migrateProject({ schemaVersion: 1, layers: [], sources: [{ id: 'x' }] }).sources).toEqual([])
  })
})
