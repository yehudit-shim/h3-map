import { afterEach, describe, expect, it } from 'vitest'
import { getSource } from './sources.js'
import { NeedsFileError, createUserSource, pruneUserSources, restoreSourceRefs, setSourceData, sourceRef, sourceRefsFor } from './userSources.js'

const data = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { a: 1 }, geometry: { type: 'Point', coordinates: [2, 48] } }] }
const result = { data, fields: [{ name: 'a', type: 'number' }], geometry: 'point', featureCount: 1 }

afterEach(() => pruneUserSources([]))

describe('user data sources', () => {
  it('registers a file source that loads from memory and exposes fields/geometry', async () => {
    const s = createUserSource({ format: 'geojson', origin: 'file', name: 'pts', fileName: 'pts.geojson' }, result)
    expect(getSource(s.id)).toBe(s)
    expect(s).toMatchObject({ kind: 'file', geometry: 'point', fields: [{ name: 'a', type: 'number' }] })
    expect(await s.load()).toBe(data)
  })

  it('saves only a reference: no data, no features', () => {
    const s = createUserSource({ format: 'csv', origin: 'file', name: 'pts', fileName: 'pts.csv' }, { ...result, csv: { latCol: 'lat', lonCol: 'lon', columns: ['lat', 'lon'] } })
    const ref = sourceRef(s)
    expect(ref).toEqual({ id: s.id, name: 'pts', kind: 'file', format: 'csv', fileName: 'pts.csv', geometry: 'point', fields: [{ name: 'a', type: 'number' }], featureCount: 1, csv: { latCol: 'lat', lonCol: 'lon' } })
    expect(JSON.stringify(ref)).not.toMatch(/coordinates|FeatureCollection/)
    expect(sourceRefsFor([{ sourceId: s.id }, { sourceId: null }, { sourceId: 'sample-pois' }])).toEqual([ref])
  })

  it('restores a file source without data: loading asks for the file again, then works', async () => {
    const s = createUserSource({ format: 'geojson', origin: 'file', name: 'pts', fileName: 'pts.geojson' }, result)
    const ref = JSON.parse(JSON.stringify(sourceRef(s)))
    pruneUserSources([]) // simulate a page reload: registry and memory are gone
    expect(getSource(ref.id)).toBeUndefined()
    expect(restoreSourceRefs([ref])).toEqual([])
    const restored = getSource(ref.id)
    expect(restored.needsFile).toBe(true)
    await expect(restored.load()).rejects.toBeInstanceOf(NeedsFileError)
    await expect(restored.load()).rejects.toMatchObject({ code: 'needs-file', message: expect.stringContaining('pts.geojson') })
    setSourceData(ref.id, { ...result, featureCount: 5 })
    expect(restored.needsFile).toBe(false)
    expect(await restored.load()).toBe(data)
    expect(restored.featureCount).toBe(5)
  })

  it('restores a URL source that can reload itself', () => {
    const ref = { id: 'user-url', name: 'remote', kind: 'url', format: 'geojson', url: 'https://example.com/a.geojson', geometry: 'polygon', fields: [] }
    expect(restoreSourceRefs([ref])).toEqual([])
    expect(getSource('user-url')).toMatchObject({ kind: 'url', url: 'https://example.com/a.geojson', geometry: 'polygon', needsFile: false })
  })

  it('does not replace a source that is already registered (keeps its in-memory data)', async () => {
    const s = createUserSource({ format: 'geojson', origin: 'file', name: 'pts', fileName: 'pts.geojson' }, result)
    restoreSourceRefs([sourceRef(s)])
    expect(getSource(s.id)).toBe(s)
    expect(await s.load()).toBe(data)
  })

  it('skips invalid references and reports them', () => {
    const problems = restoreSourceRefs([
      null,
      { id: 'a', kind: 'ftp', format: 'geojson', geometry: 'point', fields: [] },
      { id: 'b', kind: 'url', format: 'geojson', geometry: 'point', fields: [], url: 'javascript:alert(1)' },
      { id: 'c', kind: 'file', format: 'geojson', geometry: 'cube', fields: [] },
      { id: 'd', kind: 'file', format: 'geojson', geometry: 'point', fields: [{ name: 'x', type: 'date' }] },
      { id: 'e', kind: 'file', format: 'csv', geometry: 'point', fields: [], csv: { latCol: 'lat' } },
    ])
    expect(problems).toHaveLength(6)
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(getSource(id)).toBeUndefined()
  })

  it('prunes unused user sources only and never touches samples', () => {
    const a = createUserSource({ format: 'geojson', origin: 'file', name: 'a', fileName: 'a.json' }, result)
    const b = createUserSource({ format: 'geojson', origin: 'file', name: 'b', fileName: 'b.json' }, result)
    expect(pruneUserSources([a.id, 'sample-pois'])).toEqual([b.id])
    expect(getSource(a.id)).toBeDefined()
    expect(getSource(b.id)).toBeUndefined()
    expect(getSource('sample-pois')).toBeDefined()
  })
})
