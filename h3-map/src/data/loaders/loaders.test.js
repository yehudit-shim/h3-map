import { describe, expect, it } from 'vitest'
import { badRowsToCsv, buildPoints, detectLatLon, inferColumnTypes, parseCoordinate } from './csvParse.js'
import { normalizeGeoJson } from './geojsonParse.js'
import { createJob } from './jobs.js'

const feature = (geometry, properties = {}) => ({ type: 'Feature', properties, geometry })
const fc = (...features) => ({ type: 'FeatureCollection', features })

describe('normalizeGeoJson', () => {
  it('accepts every geometry type and classifies the collection', () => {
    const cases = [
      ['Point', { type: 'Point', coordinates: [2, 48] }, 'point'],
      ['MultiPoint', { type: 'MultiPoint', coordinates: [[2, 48], [3, 49]] }, 'point'],
      ['LineString', { type: 'LineString', coordinates: [[2, 48], [3, 49]] }, 'line'],
      ['MultiLineString', { type: 'MultiLineString', coordinates: [[[2, 48], [3, 49]]] }, 'line'],
      ['Polygon', { type: 'Polygon', coordinates: [[[2, 48], [3, 48], [3, 49], [2, 48]]] }, 'polygon'],
      ['MultiPolygon', { type: 'MultiPolygon', coordinates: [[[[2, 48], [3, 48], [3, 49], [2, 48]]]] }, 'polygon'],
    ]
    for (const [, geometry, klass] of cases) {
      const r = normalizeGeoJson(fc(feature(geometry)))
      expect(r.geometry).toBe(klass)
      expect(r.featureCount).toBe(1)
      expect(r.bounds).not.toBeNull()
    }
  })

  it('reports mixed geometry and the bounding box', () => {
    const r = normalizeGeoJson(fc(feature({ type: 'Point', coordinates: [2, 48] }), feature({ type: 'LineString', coordinates: [[1, 47], [4, 50]] })))
    expect(r.geometry).toBe('mixed')
    expect(r.bounds).toEqual([1, 47, 4, 50])
  })

  it('splits GeometryCollections (also nested) into one feature per member, sharing properties', () => {
    const gc = {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [2, 48] },
        { type: 'GeometryCollection', geometries: [{ type: 'LineString', coordinates: [[2, 48], [3, 49]] }, { type: 'Polygon', coordinates: [[[2, 48], [3, 48], [3, 49], [2, 48]]] }] },
      ],
    }
    const r = normalizeGeoJson(fc(feature(gc, { name: 'x' })))
    expect(r.featureCount).toBe(3)
    expect(r.data.features.map((f) => f.geometry.type)).toEqual(['Point', 'LineString', 'Polygon'])
    expect(r.data.features.every((f) => f.properties.name === 'x')).toBe(true)
    expect(r.geometry).toBe('mixed')
    expect(r.warnings.join(' ')).toMatch(/GeometryCollection/)
  })

  it('wraps a bare geometry, a bare Feature and a top-level GeometryCollection', () => {
    expect(normalizeGeoJson({ type: 'Point', coordinates: [1, 2] }).featureCount).toBe(1)
    expect(normalizeGeoJson(feature({ type: 'Point', coordinates: [1, 2] }, { a: 1 })).fields).toEqual([{ name: 'a', type: 'number' }])
    expect(normalizeGeoJson({ type: 'GeometryCollection', geometries: [{ type: 'Point', coordinates: [1, 2] }, { type: 'Point', coordinates: [3, 4] }] }).featureCount).toBe(2)
  })

  it('skips null / invalid geometries and says so', () => {
    const r = normalizeGeoJson(fc(feature(null), feature({ type: 'Point', coordinates: [1, 2] }), feature({ type: 'Circle', coordinates: [] })))
    expect(r.featureCount).toBe(1)
    expect(r.warnings.some((w) => /without geometry/.test(w))).toBe(true)
    expect(r.warnings.some((w) => /invalid or unsupported/.test(w))).toBe(true)
  })

  it('throws helpful errors for non-GeoJSON, empty and all-null input', () => {
    expect(() => normalizeGeoJson(null)).toThrow(/Not GeoJSON/)
    expect(() => normalizeGeoJson([1, 2])).toThrow(/Not GeoJSON/)
    expect(() => normalizeGeoJson({ type: 'Topology' })).toThrow(/unexpected "type"/)
    expect(() => normalizeGeoJson({ type: 'FeatureCollection' })).toThrow(/features/)
    expect(() => normalizeGeoJson(fc())).toThrow(/no features/)
    expect(() => normalizeGeoJson(fc(feature(null)))).toThrow(/No drawable/)
  })

  it('infers field names and types from properties', () => {
    const r = normalizeGeoJson(
      fc(
        feature({ type: 'Point', coordinates: [1, 2] }, { n: 1, s: 'a', mixed: 1, flag: true, obj: { a: 1 }, empty: null }),
        feature({ type: 'Point', coordinates: [1, 2] }, { n: 2.5, s: 'b', mixed: 'x', flag: false, obj: { a: 2 }, empty: null }),
      ),
    )
    const types = Object.fromEntries(r.fields.map((f) => [f.name, f.type]))
    expect(types).toMatchObject({ n: 'number', s: 'string', mixed: 'string', flag: 'string' })
    expect(types.obj).toBeUndefined() // nested objects cannot be styled
  })

  it('warns about a declared non-WGS84 CRS but accepts CRS84', () => {
    const point = feature({ type: 'Point', coordinates: [2, 48] })
    const bad = normalizeGeoJson({ ...fc(point), crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } } })
    expect(bad.warnings.join(' ')).toMatch(/EPSG::3857/)
    const ok = normalizeGeoJson({ ...fc(point), crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } } })
    expect(ok.warnings).toEqual([])
    const ok2 = normalizeGeoJson({ ...fc(point), crs: { type: 'name', properties: { name: 'EPSG:4326' } } })
    expect(ok2.warnings).toEqual([])
  })

  it('warns on projected coordinates and returns no extent', () => {
    const r = normalizeGeoJson(fc(feature({ type: 'Point', coordinates: [260000, 6250000] }), feature({ type: 'Point', coordinates: [261000, 6251000] })))
    expect(r.projected).toBe(true)
    expect(r.bounds).toBeNull()
    expect(r.warnings.join(' ')).toMatch(/projected/)
  })
})

describe('CSV helpers', () => {
  it('detects latitude/longitude columns by name and confirms with the values', () => {
    const rows = [{ Latitude: '48.8', Longitude: '2.3', n: '1' }]
    expect(detectLatLon(['Latitude', 'Longitude', 'n'], rows)).toEqual({ lat: 'Latitude', lon: 'Longitude' })
    expect(detectLatLon(['lat', 'lng'], [{ lat: '1', lng: '2' }])).toEqual({ lat: 'lat', lon: 'lng' })
    expect(detectLatLon(['LAT_deg', 'lon-deg'], [{ LAT_deg: '1', 'lon-deg': '2' }])).toEqual({ lat: 'LAT_deg', lon: 'lon-deg' })
  })

  it('returns null when names are unknown or the values are not coordinates', () => {
    expect(detectLatLon(['a', 'b'], [{ a: '1', b: '2' }])).toBeNull()
    expect(detectLatLon(['x', 'y'], [{ x: '500000', y: '6200000' }])).toBeNull() // projected metres
    expect(detectLatLon(['lat', 'lon'], [{ lat: '120', lon: '2' }])).toBeNull() // lat out of range
  })

  it('infers column types and keeps identifiers with leading zeros as text', () => {
    const rows = [{ a: '1', b: '1.5', c: '007', d: 'x', e: '', f: '' }, { a: '2', b: '-3e2', c: '010', d: '4', e: '', f: '5' }]
    expect(inferColumnTypes(['a', 'b', 'c', 'd', 'e', 'f'], rows)).toEqual({ a: 'number', b: 'number', c: 'string', d: 'string', e: 'string', f: 'number' })
  })

  it('parses coordinates, including decimal commas', () => {
    expect(parseCoordinate(' 48.85 ')).toBe(48.85)
    expect(parseCoordinate('48,85')).toBe(48.85)
    expect(parseCoordinate('abc')).toBeNaN()
    expect(parseCoordinate('')).toBeNaN()
  })

  it('builds points and reports every bad row with a reason', () => {
    const columns = ['name', 'lat', 'lon', 'v']
    const rows = [
      { name: 'ok', lat: '48.8', lon: '2.3', v: '5' },
      { name: 'nolat', lat: '', lon: '2.3', v: '1' },
      { name: 'nan', lat: 'north', lon: '2.3', v: '1' },
      { name: 'range', lat: '95', lon: '2.3', v: '1' },
      { name: 'lonrange', lat: '40', lon: '200', v: '1' },
      { name: 'ok2', lat: '49,1', lon: '2.4', v: '' },
      { name: 'short', lat: '1', lon: '2', v: '1' },
    ]
    const r = buildPoints(rows, columns, { lat: 'lat', lon: 'lon', rowErrors: new Map([[6, 'too few fields']]) })
    expect(r.features).toHaveLength(2)
    expect(r.badCount).toBe(5)
    expect(r.bad.map((b) => b.row)).toEqual([2, 3, 4, 5, 7])
    expect(r.bad.map((b) => b.reason).join('|')).toMatch(/missing latitude.*not a number.*outside -90.*outside -180.*too few/)
    expect(r.features[0].geometry.coordinates).toEqual([2.3, 48.8]) // GeoJSON order: lon, lat
    expect(r.features[0].properties).toEqual({ name: 'ok', lat: 48.8, lon: 2.3, v: 5 })
    expect(r.features[1].properties.v).toBeNull()
    expect(r.fields.find((f) => f.name === 'v').type).toBe('number')
  })

  it('caps the recorded bad rows but keeps counting', () => {
    const rows = Array.from({ length: 50 }, () => ({ lat: 'x', lon: '1' }))
    const r = buildPoints(rows, ['lat', 'lon'], { lat: 'lat', lon: 'lon', maxBad: 10 })
    expect(r.badCount).toBe(50)
    expect(r.bad).toHaveLength(10)
    expect(r.badTruncated).toBe(true)
  })

  it('exports bad rows as CSV with escaping', () => {
    const csv = badRowsToCsv([{ row: 3, reason: 'bad, "value"', values: { a: 'x,y', b: 2 } }], ['a', 'b'])
    expect(csv.split('\n')).toEqual(['row,reason,a,b', '3,"bad, ""value""","x,y",2'])
  })
})

/** Run a job to completion against an in-process emit (the worker uses the same code). */
function run(messages, options) {
  return new Promise((resolve) => {
    const out = { progress: [], chunks: [], inspect: null, done: null, error: null }
    const job = createJob((m) => {
      if (m.type === 'progress') out.progress.push(m)
      else if (m.type === 'chunk') out.chunks.push(m.features)
      else if (m.type === 'csv-inspect') out.inspect = m
      else if (m.type === 'done') out.done = m.meta
      else if (m.type === 'error') out.error = m.message
    }, options)
    ;(async () => {
      for (const m of messages) await job.handle(m)
      resolve(out)
    })()
  })
}

describe('parse jobs', () => {
  it('parses GeoJSON text and sends the features in chunks', async () => {
    const features = Array.from({ length: 25 }, (_, i) => feature({ type: 'Point', coordinates: [i / 10, 48] }, { i }))
    const out = await run([{ type: 'start', format: 'geojson', source: { text: JSON.stringify(fc(...features)) } }], { chunkSize: 10 })
    expect(out.chunks.map((c) => c.length)).toEqual([10, 10, 5])
    expect(out.done).toMatchObject({ featureCount: 25, geometry: 'point', fields: [{ name: 'i', type: 'number' }] })
  })

  it('reads a File with progress', async () => {
    const text = JSON.stringify(fc(feature({ type: 'Point', coordinates: [1, 2] })))
    const out = await run([{ type: 'start', format: 'geojson', source: { file: new File([text], 'a.geojson') } }])
    expect(out.progress.some((p) => p.phase === 'read' && p.total === text.length)).toBe(true)
    expect(out.done.featureCount).toBe(1)
  })

  it('reports JSON syntax errors and non-GeoJSON as errors, not exceptions', async () => {
    expect((await run([{ type: 'start', format: 'geojson', source: { text: '{"type": ' } }])).error).toMatch(/not valid JSON/)
    expect((await run([{ type: 'start', format: 'geojson', source: { text: '{"hello": 1}' } }])).error).toMatch(/Not GeoJSON/)
  })

  const csvText = 'name,lat,lon,value\nA,48.1,2.1,1\nB,48.2,2.2,2\nC,bad,2.3,3\nD,48.4,2.4\n\nE,48.5,2.5,5\n'

  it('CSV: pauses to inspect, detects columns, then builds points and reports bad rows', async () => {
    const first = await run([{ type: 'start', format: 'csv', source: { text: csvText } }])
    expect(first.inspect).toMatchObject({ columns: ['name', 'lat', 'lon', 'value'], detected: { lat: 'lat', lon: 'lon' }, rowCount: 5 })
    expect(first.inspect.types.value).toBe('number')
    const out = await run([{ type: 'start', format: 'csv', source: { text: csvText } }, { type: 'csv-build', lat: 'lat', lon: 'lon' }])
    expect(out.done.featureCount).toBe(3)
    expect(out.done.report.badCount).toBe(2)
    expect(out.done.report.bad.map((b) => b.reason).join('|')).toMatch(/not a number/)
    expect(out.done.report.bad.map((b) => b.reason).join('|')).toMatch(/too few fields/)
    expect(out.done.warnings[0]).toMatch(/2 of 5 rows/)
    expect(out.done.geometry).toBe('point')
    expect(out.done.bounds).toEqual([2.1, 48.1, 2.5, 48.5])
  })

  it('CSV: builds straight away when the columns are given (reload of a saved source)', async () => {
    const out = await run([{ type: 'start', format: 'csv', source: { text: csvText }, csv: { latCol: 'lat', lonCol: 'lon' } }])
    expect(out.inspect).toBeNull()
    expect(out.done.featureCount).toBe(3)
  })

  it('CSV: offers manual column choice when detection fails and rejects a bad choice', async () => {
    const text = 'p,q\n48.1,2.1\n48.2,2.2\n'
    const first = await run([{ type: 'start', format: 'csv', source: { text } }])
    expect(first.inspect.detected).toBeNull()
    const ok = await run([{ type: 'start', format: 'csv', source: { text } }, { type: 'csv-build', lat: 'p', lon: 'q' }])
    expect(ok.done.featureCount).toBe(2)
    const same = await run([{ type: 'start', format: 'csv', source: { text } }, { type: 'csv-build', lat: 'p', lon: 'p' }])
    expect(same.error).toMatch(/different/)
    const swapped = await run([{ type: 'start', format: 'csv', source: { text: 'a,b\n2.1,148.1\n2.2,148.2\n' } }, { type: 'csv-build', lat: 'b', lon: 'a' }])
    expect(swapped.error).toMatch(/No valid points/)
  })

  it('CSV: errors for header-only files and handles semicolon delimiters with decimal commas', async () => {
    expect((await run([{ type: 'start', format: 'csv', source: { text: 'lat,lon\n' } }])).error).toMatch(/no data rows/)
    const out = await run([{ type: 'start', format: 'csv', source: { text: 'lat;lon;z\n48,5;2,5;1\n49,5;3,5;2\n' } }, { type: 'csv-build', lat: 'lat', lon: 'lon' }])
    expect(out.done.featureCount).toBe(2)
    expect(out.done.bounds).toEqual([2.5, 48.5, 3.5, 49.5])
  })

  it('handles a few hundred thousand rows without trouble (chunked output)', async () => {
    const lines = ['id,lat,lon,v']
    for (let i = 0; i < 100000; i++) lines.push(`${i},${48 + (i % 1000) / 1000},${2 + (i % 777) / 1000},${i % 13}`)
    const out = await run([{ type: 'start', format: 'csv', source: { text: lines.join('\n') } }, { type: 'csv-build', lat: 'lat', lon: 'lon' }])
    expect(out.done.featureCount).toBe(100000)
    expect(out.chunks).toHaveLength(5)
  }, 30000)

  it('rejects unknown formats', async () => {
    expect((await run([{ type: 'start', format: 'kml', source: { text: '' } }])).error).toMatch(/Unknown format/)
  })
})
