import { getSource } from '../data/sources.js'
import { createId } from '../lib/ids.js'
import { getLayerType } from './registry.js'

/**
 * Create a serialisable layer config. deck.gl Layer objects are derived from configs and never stored
 * (docs/SYSTEM_ARCHITECTURE.md §3.2).
 */
export function createLayerConfig(typeId, sourceId, overrides = {}) {
  const type = getLayerType(typeId)
  if (!type) throw new Error(`Unknown layer type "${typeId}"`)
  const source = getSource(sourceId)
  if (!source) throw new Error(`Unknown data source "${sourceId}"`)
  if (!type.geometry.includes(source.geometry)) {
    throw new Error(`Layer type "${typeId}" cannot draw ${source.geometry} data`)
  }
  const { style: styleOverrides, ...rest } = overrides
  return {
    id: createId(typeId),
    name: `${type.label} · ${source.name.replace(/\s*\(.*\)$/, '')}`,
    type: typeId,
    sourceId,
    visible: true,
    opacity: 1,
    ...rest,
    style: { ...type.defaults(source), ...styleOverrides },
  }
}
