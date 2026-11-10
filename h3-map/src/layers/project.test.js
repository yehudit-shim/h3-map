import { describe, expect, it } from 'vitest'
import { createLayerConfig } from './index.js'
import { PROJECT_FORMAT, SCHEMA_VERSION, migrateProject, readProject, sanitizeTree, serializeProject } from './project.js'
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
