// Serialisation of the layer tree: versioned project JSON, migrations and validation.
// Pure functions: no React, no stores. Used for localStorage auto-save and for import/export.
//
// Project file (schemaVersion 2):
//   { format: 'h3map.project', schemaVersion: 2, savedAt: ISO string, layers: Node[], sources: SourceRef[] }
// where Node is a layer config or a group (see tree.js) and SourceRef is the small reference to a
// user-loaded data source (URL, or file name + columns; see data/userSources.js). The data of loaded
// files is never part of a project: file layers come back asking for the file again.
//
// Version history
//   0  flat array of layer configs without `kind` (Phase 1-2 layer list)
//   1  layer tree with groups; every node has `kind`
//   2  `sources` list (user GeoJSON/CSV references); layers of sourceless types (xyz, wms) have `sourceId: null`
import { getSource } from '../data/sources.js'
import { restoreSourceRefs, sourceRefsFor } from '../data/userSources.js'
import { createId } from '../lib/ids.js'
import { getLayerType } from './registry.js'
import { MAX_DEPTH } from './tree.js'

export const PROJECT_FORMAT = 'h3map.project'
export const SCHEMA_VERSION = 2

const clamp01 = (v, fallback = 1) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)
const str = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback)

/** Bring any supported payload to the current schema. Throws on unknown or future versions. */
export function migrateProject(input) {
  if (Array.isArray(input)) return { format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, layers: input.map(addKind), sources: [] }
  if (!input || typeof input !== 'object') throw new Error('Not a project file')
  if (input.format !== undefined && input.format !== PROJECT_FORMAT) throw new Error(`Unsupported file format "${input.format}"`)
  const v = input.schemaVersion ?? 0
  if (typeof v !== 'number' || v > SCHEMA_VERSION) throw new Error(`Project schema version ${v} is newer than this app supports (${SCHEMA_VERSION})`)
  if (!Array.isArray(input.layers)) throw new Error('Project has no "layers" list')
  const layers = v === 0 ? input.layers.map(addKind) : input.layers
  // v0/v1 projects predate user data sources.
  const sources = v >= 2 && Array.isArray(input.sources) ? input.sources : []
  return { ...input, format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, layers, sources }
}

function addKind(n) {
  if (!n || typeof n !== 'object' || n.kind) return n
  return Array.isArray(n.children) ? { ...n, kind: 'group', children: n.children.map(addKind) } : { ...n, kind: 'layer' }
}

/**
 * Validate and normalise a migrated layer tree. Invalid nodes are dropped (and reported), missing
 * style keys are filled from the layer type defaults, and duplicate ids are replaced.
 * @returns {{tree: object[], problems: string[]}}
 */
export function sanitizeTree(nodes) {
  const problems = []
  const seen = new Set()
  const uniqueId = (id, prefix) => {
    const ok = typeof id === 'string' && id && !seen.has(id)
    const out = ok ? id : createId(prefix)
    seen.add(out)
    return out
  }
  const visit = (list, depth) => {
    const out = []
    for (const n of Array.isArray(list) ? list : []) {
      if (!n || typeof n !== 'object') {
        problems.push('Skipped an entry that is not a layer or group')
        continue
      }
      if (n.kind === 'group') {
        if (depth >= MAX_DEPTH - 1) {
          problems.push(`Group "${n.name}" is nested too deeply and was skipped`)
          continue
        }
        out.push({
          kind: 'group',
          id: uniqueId(n.id, 'group'),
          name: str(n.name, 'Group'),
          visible: n.visible !== false,
          opacity: clamp01(n.opacity),
          expanded: n.expanded !== false,
          children: visit(n.children, depth + 1),
        })
        continue
      }
      const type = getLayerType(n.type)
      const source = type?.sourceless ? undefined : getSource(n.sourceId)
      if (!type) {
        problems.push(`Layer "${n.name ?? n.id}" uses unknown layer type "${n.type}"`)
        continue
      }
      if (!type.sourceless) {
        if (!source) {
          problems.push(`Layer "${n.name ?? n.id}" uses unknown data source "${n.sourceId}"`)
          continue
        }
        if (!type.geometry.includes(source.geometry)) {
          problems.push(`Layer "${n.name ?? n.id}": ${type.label} cannot draw ${source.geometry} data`)
          continue
        }
      }
      const style = n.style && typeof n.style === 'object' && !Array.isArray(n.style) ? n.style : {}
      const merged = { ...type.defaults(source), ...style }
      const styleProblem = type.validate?.(merged)
      if (styleProblem) {
        problems.push(`Layer "${n.name ?? n.id}": ${styleProblem}`)
        continue
      }
      out.push({
        kind: 'layer',
        id: uniqueId(n.id, n.type),
        name: str(n.name, type.label),
        type: n.type,
        sourceId: type.sourceless ? null : n.sourceId,
        visible: n.visible !== false,
        opacity: clamp01(n.opacity),
        style: merged,
      })
    }
    return out
  }
  return { tree: visit(nodes, 0), problems }
}

/**
 * Parse a project (object or JSON text) into a clean tree. Throws for unreadable files.
 * Saved user-source references are registered first so their layers validate.
 */
export function readProject(input) {
  const raw = typeof input === 'string' ? JSON.parse(input) : input
  const project = migrateProject(raw)
  const sourceProblems = restoreSourceRefs(project.sources)
  const { tree, problems } = sanitizeTree(project.layers)
  return { tree, problems: [...sourceProblems, ...problems] }
}

export function serializeProject(tree, now = new Date()) {
  const layers = []
  const collect = (nodes) => nodes.forEach((n) => (n.kind === 'group' ? collect(n.children ?? []) : layers.push(n)))
  collect(tree)
  return { format: PROJECT_FORMAT, schemaVersion: SCHEMA_VERSION, savedAt: now.toISOString(), layers: structuredClone(tree), sources: sourceRefsFor(layers) }
}
