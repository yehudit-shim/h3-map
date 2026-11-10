// Actions available on a layer-tree node. One list feeds the context menu, the "More" button and
// keyboard shortcuts, so every layer type (and future ones) gets the same behaviour with no
// type-specific UI code.
import {
  ArrowDown, ArrowUp, Copy, Crosshair, Eye, EyeOff, FolderInput, FolderOutput, FolderPlus, Info, Pencil, SlidersHorizontal, Trash2, Ungroup,
} from 'lucide-react'
import { isGroup, layerIdsOf, locate } from '../layers/tree.js'
import { getSource } from '../data/sources.js'
import { runParse } from '../data/loaders/client.js'
import { createMvtUrlSource, createPgSource } from '../data/pgSources.js'
import { createUserSource, setSourceData } from '../data/userSources.js'
import { unionBounds } from '../lib/geo.js'
import { zoomToBounds } from '../map/mapActions.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { notify } from '../state/notifyStore.js'
import { useUiStore } from '../state/uiStore.js'

/** Data extent of a layer, or the union of the extents inside a group. */
export function nodeBounds(node, entries = useDataStore.getState().entries) {
  if (!node) return null
  const { layers } = useLayersStore.getState()
  const ids = new Set(layerIdsOf(node))
  return unionBounds(layers.filter((l) => ids.has(l.id)).map((l) => entries[l.sourceId]?.bounds))
}

export function zoomToNode(node) {
  const b = nodeBounds(node)
  if (b) zoomToBounds(b)
  return !!b
}

/**
 * @param {object} node layer config or group
 * @param {{rename: () => void}} hooks UI callbacks that live in components (inline rename)
 */
export function nodeActions(node, { rename }) {
  const s = useLayersStore.getState()
  const loc = locate(s.tree, node.id)
  const group = isGroup(node)
  const prev = loc && loc.index > 0 ? loc.siblings[loc.index - 1] : null
  const multi = s.selectedIds.length > 1 && s.selectedIds.includes(node.id)
  const noun = group ? 'group' : 'layer'
  return [
    { id: 'toggle', label: node.visible ? `Hide ${noun}` : `Show ${noun}`, icon: node.visible ? EyeOff : Eye, onSelect: () => s.toggleVisible(node.id) },
    { id: 'zoom', label: `Zoom to ${noun}`, icon: Crosshair, disabled: !nodeBounds(node), onSelect: () => zoomToNode(node) },
    { id: 'properties', label: 'Properties…', icon: Info, onSelect: () => useUiStore.getState().openProperties(node.id) },
    ...(group
      ? []
      : [{ id: 'style', label: 'Edit style', icon: SlidersHorizontal, onSelect: () => { s.setActive(node.id); useUiStore.getState().openStyle() } }]),
    { separator: true },
    { id: 'rename', label: 'Rename', icon: Pencil, shortcut: 'F2', onSelect: rename },
    { id: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => s.duplicateNode(node.id) },
    { separator: true },
    { id: 'up', label: 'Move up', icon: ArrowUp, shortcut: 'Alt+↑', disabled: !loc || loc.index === 0, onSelect: () => s.moveLayer(node.id, -1) },
    { id: 'down', label: 'Move down', icon: ArrowDown, shortcut: 'Alt+↓', disabled: !loc || loc.index === loc.siblings.length - 1, onSelect: () => s.moveLayer(node.id, 1) },
    { id: 'indent', label: 'Move into group above', icon: FolderInput, shortcut: 'Alt+→', disabled: !isGroup(prev), onSelect: () => s.indent(node.id) },
    { id: 'outdent', label: 'Move out of group', icon: FolderOutput, shortcut: 'Alt+←', disabled: !loc?.parent, onSelect: () => s.outdent(node.id) },
    { separator: true },
    multi
      ? { id: 'group', label: `Group ${s.selectedIds.length} selected`, icon: FolderPlus, onSelect: () => s.createGroup(s.selectedIds) }
      : { id: 'group', label: 'Add to new group', icon: FolderPlus, onSelect: () => s.createGroup([node.id]) },
    ...(group ? [{ id: 'ungroup', label: 'Ungroup', icon: Ungroup, onSelect: () => s.ungroup(node.id) }] : []),
    { separator: true },
    { id: 'remove', label: group ? 'Remove group and its layers' : 'Remove layer', icon: Trash2, danger: true, onSelect: () => s.removeNode(node.id) },
  ]
}

/**
 * Where a dragged node lands relative to the row under the pointer.
 * Layers: upper half = before (above), lower half = after. Groups: top band = before; the rest drops
 * inside, except the bottom band of a collapsed group, which drops after it.
 */
export function dropPosition(offsetY, height, { group = false, expanded = false } = {}) {
  if (!(height > 0)) return group ? 'inside' : 'before'
  const r = offsetY / height
  if (!group) return r < 0.5 ? 'before' : 'after'
  if (r < 0.25) return 'before'
  if (r > 0.75 && !expanded) return 'after'
  return 'inside'
}

/**
 * Add a layer for freshly parsed user data (GeoJSON / CSV file or URL): registers the source, stores the
 * data (already in memory, no second download), adds the layer on top and zooms to it.
 * @param {{input: {format:string, origin:'file'|'url', name:string, fileName?:string, url?:string}, result: object, typeId: string, name?: string}} args
 */
export function addParsedDataLayer({ input, result, typeId, name }) {
  const source = createUserSource(input, result)
  useDataStore.getState().provide(source.id, result.data, { bounds: result.bounds, report: result.report, warnings: result.warnings })
  const layer = useLayersStore.getState().addLayer(typeId, source.id, name?.trim() ? { name: name.trim() } : undefined)
  useUiStore.getState().openLeftTab('layers')
  const bounds = useDataStore.getState().entries[source.id]?.bounds
  if (bounds) zoomToBounds(bounds)
  return layer
}

/**
 * Add a layer for a database table (from the add-to-map dialog): registers the source, adds the layer on top and zooms
 * to the table's extent. Data loads through the data store (viewport sources wait for the map to settle).
 * @param {{input: object, typeId: string, name?: string}} args input is a createPgSource() input (see data/pgPlan.js)
 */
export function addDatabaseLayer({ input, typeId, name }) {
  const source = createPgSource(input)
  const layer = useLayersStore.getState().addLayer(typeId, source.id, name?.trim() ? { name: name.trim() } : undefined)
  useUiStore.getState().openLeftTab('layers')
  if (source.bounds) zoomToBounds(source.bounds)
  return layer
}

/** Add a layer for a public MVT URL. Throws with a readable message for an unusable URL. */
export function addMvtUrlLayer({ name, url, sourceLayer, minzoom, maxzoom, geometry }) {
  const source = createMvtUrlSource({ name, url, sourceLayer, minzoom, maxzoom, geometry })
  const layer = useLayersStore.getState().addLayer('mvt', source.id, name?.trim() ? { name: name.trim() } : undefined)
  useUiStore.getState().openLeftTab('layers')
  return layer
}

/** Replace the strategy of a database layer with vector tiles (the "truncated" banner offers this). */
export function switchLayerToTiles(layerId) {
  const layer = useLayersStore.getState().layers.find((l) => l.id === layerId)
  const source = layer && getSource(layer.sourceId)
  if (!source || source.kind !== 'postgis') return false
  const next = createPgSource({ ...source, strategy: 'mvt', geometry: source.geometry === 'h3' ? 'mixed' : source.geometry })
  useLayersStore.getState().retargetLayer(layerId, 'mvt', next.id)
  return true
}

/** Add a web-map layer (XYZ / WMS): no data source, the service is described by the style. */
export function addWebLayer(typeId, { name, style, opacity = 1 }) {
  const layer = useLayersStore.getState().addLayer(typeId, null, { ...(name?.trim() ? { name: name.trim() } : {}), style, opacity })
  useUiStore.getState().openLeftTab('layers')
  return layer
}

/** Supply the file again for a file source that was restored without its data. */
export async function reloadSourceFile(sourceId, file) {
  const source = getSource(sourceId)
  if (!source || source.kind !== 'file') return false
  try {
    const result = await runParse({ format: source.format, source: { file }, csv: source.csv }).promise
    if (result.geometry !== source.geometry) notify(`${file.name} contains ${result.geometry} data, but the layer was made for ${source.geometry} data. It may not draw.`, { kind: 'warn' })
    setSourceData(sourceId, result)
    useDataStore.getState().provide(sourceId, result.data, { bounds: result.bounds, report: result.report, warnings: result.warnings })
    notify(`Loaded ${result.featureCount.toLocaleString('en-US')} features from ${file.name}`, { kind: 'success' })
    return true
  } catch (error) {
    notify(`Could not load ${file.name}: ${error.message}`, { kind: 'error' })
    return false
  }
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function importLayersFile(file) {
  try {
    const { problems, count } = useLayersStore.getState().loadProject(await file.text())
    notify(`Loaded ${count} layer${count === 1 ? '' : 's'} from ${file.name}`, { kind: 'success' })
    if (problems.length) notify(`${problems.length} item(s) were skipped: ${problems.slice(0, 3).join('; ')}`, { kind: 'warn' })
  } catch (error) {
    notify(`Could not load ${file.name}: ${error.message}`, { kind: 'error' })
  }
}
