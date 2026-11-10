// User-provided data sources: GeoJSON / CSV files and URLs, registered in the source registry at runtime.
//
// Persistence rule: loaded file data is large and is NEVER saved. Only a small reference
// (`sourceRef`: name, url or file name, geometry, fields, csv columns) goes into the project JSON.
// URL sources reload themselves from the URL; file sources come back as "needs file" and the user is
// asked to pick the file again (the layer keeps its style meanwhile).
import { runParse, checkUrl } from './loaders/client.js'
import { registerSource, getSource, unregisterSource, dataSources } from './sources.js'
import { createId } from '../lib/ids.js'

const GEOMETRIES = ['point', 'line', 'polygon', 'mixed']
const FORMATS = ['geojson', 'csv']

/** The source cannot load until the user supplies the file again. */
export class NeedsFileError extends Error {
  constructor(source) {
    super(`"${source.fileName ?? source.name}" must be loaded again: the file's data is not stored in the browser.`)
    this.name = 'NeedsFileError'
    this.code = 'needs-file'
  }
}

const memory = new Map() // source id -> GeoJSON held in memory (file sources)

export const isUserSource = (s) => s?.kind === 'file' || s?.kind === 'url'

/**
 * Create and register a user source from a finished parse result.
 * @param {{format:'geojson'|'csv', origin:'file'|'url', name:string, fileName?:string, url?:string}} input
 * @param {{data:object, fields:object[], geometry:string, featureCount:number, csv?:object}} result
 */
export function createUserSource(input, result) {
  const id = createId('user')
  const source = buildSource({
    id,
    name: input.name,
    kind: input.origin,
    format: input.format,
    fileName: input.fileName,
    url: input.url,
    geometry: result.geometry,
    fields: result.fields,
    featureCount: result.featureCount,
    csv: result.csv ? { latCol: result.csv.latCol, lonCol: result.csv.lonCol } : undefined,
  })
  if (source.kind === 'file') memory.set(id, result.data)
  return registerSource(source)
}

function describeSource(s) {
  const what = s.format === 'csv' ? 'CSV points' : 'GeoJSON'
  return s.kind === 'url' ? `${what} from ${s.url}` : `${what} from file ${s.fileName ?? s.name}`
}

function buildSource(meta) {
  const source = {
    ...meta,
    description: describeSource(meta),
    get needsFile() {
      return source.kind === 'file' && !memory.has(source.id)
    },
    async load() {
      if (source.kind === 'file') {
        const data = memory.get(source.id)
        if (!data) throw new NeedsFileError(source)
        return data
      }
      const result = await runParse({ format: source.format, source: { url: source.url }, csv: source.csv }).promise
      return result.data
    },
  }
  return source
}

/** Attach freshly parsed data to a file source (the "reload file" flow). */
export function setSourceData(sourceId, result) {
  const source = getSource(sourceId)
  if (!isUserSource(source) || source.kind !== 'file') throw new Error('Not a file source')
  memory.set(sourceId, result.data)
  source.fields = result.fields
  source.geometry = result.geometry
  source.featureCount = result.featureCount
}

/** Serialisable reference to a user source (no data). */
export function sourceRef(source) {
  const { id, name, kind, format, fileName, url, geometry, fields, featureCount, csv } = source
  const ref = { id, name, kind, format, geometry, fields: fields.map((f) => ({ name: f.name, type: f.type })) }
  if (fileName) ref.fileName = fileName
  if (url) ref.url = url
  if (featureCount != null) ref.featureCount = featureCount
  if (csv) ref.csv = { latCol: csv.latCol, lonCol: csv.lonCol }
  return ref
}

/** References for the user sources used by a list of layer configs. */
export function sourceRefsFor(layers) {
  const ids = new Set(layers.map((l) => l.sourceId))
  return dataSources.filter((s) => isUserSource(s) && ids.has(s.id)).map(sourceRef)
}

const str = (v) => typeof v === 'string' && v.trim() !== ''

/** Validate a saved reference; returns the problem or null. */
function refProblem(r) {
  if (!r || typeof r !== 'object') return 'not an object'
  if (!str(r.id)) return 'missing id'
  if (r.kind !== 'file' && r.kind !== 'url') return `unknown kind "${r.kind}"`
  if (!FORMATS.includes(r.format)) return `unknown format "${r.format}"`
  if (!GEOMETRIES.includes(r.geometry)) return `unknown geometry "${r.geometry}"`
  if (!Array.isArray(r.fields) || r.fields.some((f) => !f || !str(f.name) || (f.type !== 'number' && f.type !== 'string'))) return 'invalid fields'
  if (r.kind === 'url' && (!str(r.url) || checkUrl(r.url).error)) return 'invalid URL'
  if (r.csv && !(str(r.csv.latCol) && str(r.csv.lonCol))) return 'invalid CSV columns'
  return null
}

/**
 * Register saved source references (project load / auto-restore). Sources already registered in this
 * session keep their in-memory data. Returns the problems found; invalid references are skipped.
 */
export function restoreSourceRefs(refs) {
  const problems = []
  for (const r of Array.isArray(refs) ? refs : []) {
    const problem = refProblem(r)
    if (problem) {
      problems.push(`Skipped a saved data source (${problem})`)
      continue
    }
    if (getSource(r.id)) continue
    registerSource(
      buildSource({
        id: r.id,
        name: str(r.name) ? r.name : r.fileName ?? r.url ?? 'Data',
        kind: r.kind,
        format: r.format,
        fileName: str(r.fileName) ? r.fileName : undefined,
        url: r.kind === 'url' ? r.url : undefined,
        geometry: r.geometry,
        fields: r.fields.map((f) => ({ name: f.name, type: f.type })),
        featureCount: typeof r.featureCount === 'number' ? r.featureCount : undefined,
        csv: r.csv ? { latCol: r.csv.latCol, lonCol: r.csv.lonCol } : undefined,
      }),
    )
  }
  return problems
}

/** Unregister (and free the memory of) user sources that no layer uses any more. Returns the removed ids. */
export function pruneUserSources(usedIds) {
  const used = new Set(usedIds)
  const removed = dataSources.filter((s) => isUserSource(s) && !used.has(s.id)).map((s) => s.id)
  for (const id of removed) {
    unregisterSource(id)
    memory.delete(id)
  }
  return removed
}
