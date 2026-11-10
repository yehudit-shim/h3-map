// Parse jobs: the platform-independent core of the worker (parse.worker.js) and of the main-thread
// fallback used where Workers do not exist (tests). A job turns a file / URL / text into a GeoJSON
// point-or-geometry collection and reports back through `emit`:
//
//   { type: 'progress', phase: 'read'|'parse'|'build', loaded?, total? }
//   { type: 'csv-inspect', columns, types, detected, sample, rowCount }   CSV only: waiting for column choice
//   { type: 'chunk', features }                                           result features, in slices
//   { type: 'done', meta }                                                {fields, geometry, bounds, featureCount, warnings, report?}
//   { type: 'error', message }
//
// Features are sent in slices so the main thread never has to deserialise one huge message in a single task.
import Papa from 'papaparse'
import { buildPoints, detectLatLon, inferColumnTypes } from './csvParse.js'
import { normalizeGeoJson } from './geojsonParse.js'

export const CHUNK_SIZE = 20000
const PROGRESS_INTERVAL_MS = 80

/** Error whose message is already suitable for the user. */
class JobError extends Error {}

function throttle(fn) {
  let last = 0
  return (value, force = false) => {
    const now = Date.now()
    if (force || now - last >= PROGRESS_INTERVAL_MS) {
      last = now
      fn(value)
    }
  }
}

async function readStream(stream, total, onProgress) {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  const parts = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    loaded += value.byteLength
    parts.push(decoder.decode(value, { stream: true }))
    onProgress({ loaded, total })
  }
  parts.push(decoder.decode())
  return parts.join('')
}

/** Read the source text with progress. Sources: {text} | {file} | {url}. */
export async function readSourceText(source, emitProgress) {
  const onProgress = throttle(({ loaded, total }) => emitProgress({ type: 'progress', phase: 'read', loaded, total }))
  if (typeof source.text === 'string') return source.text
  if (source.file) {
    const { file } = source
    if (typeof file.stream !== 'function') {
      emitProgress({ type: 'progress', phase: 'read', loaded: file.size, total: file.size })
      return file.text()
    }
    return readStream(file.stream(), file.size, onProgress)
  }
  if (source.url) {
    let response
    try {
      response = await fetch(source.url)
    } catch {
      throw new JobError(`Could not download ${source.url}. The server may be unreachable or may not allow cross-origin requests (CORS).`)
    }
    if (!response.ok) throw new JobError(`The server answered ${response.status} ${response.statusText || ''} for ${source.url}`.trim())
    const total = Number(response.headers.get('content-length')) || 0
    if (!response.body) return response.text()
    return readStream(response.body, total, onProgress)
  }
  throw new JobError('No data source given')
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch (e) {
    const where = /position (\d+)/.exec(e.message)
    throw new JobError(`The file is not valid JSON${where ? ` (error near character ${Number(where[1]).toLocaleString('en-US')})` : ''}.`)
  }
}

/**
 * @param {(msg: object) => void} emit
 * @param {{chunkSize?: number}} [options]
 */
export function createJob(emit, { chunkSize = CHUNK_SIZE } = {}) {
  let csv = null // parsed rows kept while the user chooses lat/lon columns

  const emitResult = (features, meta) => {
    for (let i = 0; i < features.length; i += chunkSize) emit({ type: 'chunk', features: features.slice(i, i + chunkSize) })
    emit({ type: 'done', meta })
  }

  async function runGeoJson(source) {
    const text = await readSourceText(source, emit)
    emit({ type: 'progress', phase: 'parse' })
    const result = normalizeGeoJson(parseJson(text))
    const { data, ...meta } = result
    emitResult(data.features, meta)
  }

  function parseCsvText(text) {
    emit({ type: 'progress', phase: 'parse', loaded: 0, total: text.length })
    const onProgress = throttle((loaded) => emit({ type: 'progress', phase: 'parse', loaded, total: text.length }))
    const rows = []
    const rowErrors = new Map()
    let columns = null
    let quoteErrors = 0
    Papa.parse(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h, i) => (String(h).trim() === '' ? `column_${i + 1}` : String(h).trim()),
      chunkSize: 1 << 20,
      chunk: (results) => {
        if (!columns) columns = results.meta.fields ?? []
        const base = rows.length
        for (const err of results.errors) {
          if (err.type === 'FieldMismatch' && typeof err.row === 'number') {
            // `row` counts across chunks in papaparse; fall back to chunk-relative when it is smaller than the base
            const index = err.row >= base ? err.row : base + err.row
            rowErrors.set(index, err.code === 'TooFewFields' ? `too few fields (${err.message.replace(/^Too few fields: /, '')})` : `too many fields (${err.message.replace(/^Too many fields: /, '')})`)
          } else if (err.type === 'Quotes') quoteErrors++
        }
        for (let i = 0; i < results.data.length; i++) rows.push(results.data[i])
        onProgress(results.meta.cursor)
      },
    })
    if (!columns || columns.length === 0) throw new JobError('The CSV has no header row.')
    if (!rows.length) throw new JobError('The CSV has a header but no data rows.')
    return { rows, columns, rowErrors, quoteErrors }
  }

  function buildCsv(lat, lon) {
    const { rows, columns, types, rowErrors, quoteErrors } = csv
    if (!columns.includes(lat) || !columns.includes(lon)) throw new JobError('Choose the latitude and longitude columns.')
    if (lat === lon) throw new JobError('Latitude and longitude must be different columns.')
    emit({ type: 'progress', phase: 'build', loaded: 0, total: rows.length })
    const built = buildPoints(rows, columns, { lat, lon, types, rowErrors })
    if (!built.features.length) {
      const first = built.bad[0]
      throw new JobError(`No valid points: all ${built.badCount.toLocaleString('en-US')} rows were rejected${first ? ` (e.g. row ${first.row}: ${first.reason})` : ''}. Check that the latitude and longitude columns are the right way round.`)
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const f of built.features) {
      const [x, y] = f.geometry.coordinates
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    const warnings = []
    if (built.badCount) warnings.push(`${built.badCount.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} rows could not be turned into points and were skipped`)
    if (quoteErrors) warnings.push(`${quoteErrors.toLocaleString('en-US')} malformed quoted value(s) were found; the affected rows may be wrong`)
    const meta = {
      fields: built.fields,
      geometry: 'point',
      bounds: [minX, minY, maxX, maxY],
      featureCount: built.features.length,
      warnings,
      projected: false,
      csv: { latCol: lat, lonCol: lon, columns },
      report: { rowCount: rows.length, badCount: built.badCount, bad: built.bad, badTruncated: built.badTruncated },
    }
    csv = null
    emitResult(built.features, meta)
  }

  async function runCsv(source, columnsChoice) {
    const text = await readSourceText(source, emit)
    const parsed = parseCsvText(text)
    const types = inferColumnTypes(parsed.columns, parsed.rows)
    csv = { ...parsed, types }
    const detected = detectLatLon(parsed.columns, parsed.rows.slice(0, 200))
    const chosen = columnsChoice && parsed.columns.includes(columnsChoice.latCol) && parsed.columns.includes(columnsChoice.lonCol)
      ? { lat: columnsChoice.latCol, lon: columnsChoice.lonCol }
      : null
    if (chosen) return buildCsv(chosen.lat, chosen.lon)
    emit({
      type: 'csv-inspect',
      columns: parsed.columns,
      types,
      detected,
      sample: parsed.rows.slice(0, 5),
      rowCount: parsed.rows.length,
    })
  }

  return {
    /** Handle one message from the client. Errors are reported as {type:'error'}, never thrown. */
    async handle(msg) {
      try {
        if (msg.type === 'start') {
          if (msg.format === 'geojson') await runGeoJson(msg.source)
          else if (msg.format === 'csv') await runCsv(msg.source, msg.csv)
          else throw new JobError(`Unknown format "${msg.format}"`)
        } else if (msg.type === 'csv-build') {
          if (!csv) throw new JobError('No CSV is waiting for column selection')
          buildCsv(msg.lat, msg.lon)
        }
      } catch (e) {
        csv = null
        emit({ type: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    },
  }
}
