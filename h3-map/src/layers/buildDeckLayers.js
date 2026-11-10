import { getSource } from '../data/sources.js'
import { getLayerType } from './registry.js'

// Prepared data (aggregations, colour scales) is memoised per layer so selection changes,
// opacity edits and pans never recompute it.
const preparedCache = new Map() // layerId -> { data, key, value }

function prepareLayer(type, config, data, ctx) {
  const key = type.prepareKey(config, ctx)
  const hit = preparedCache.get(config.id)
  if (hit && hit.data === data && hit.key === key) return hit.value
  const value = type.prepare(config, data, { ...ctx, source: getSource(config.sourceId) })
  preparedCache.set(config.id, { data, key, value })
  return value
}

export function forgetLayer(layerId) {
  preparedCache.delete(layerId)
}

/**
 * Pure function: layer configs -> deck.gl layers. A failing layer never takes the others down.
 * @param {object[]} configs layer configs in render order (first = bottom)
 * @param {Record<string,{status:string,data?:object}>} sourceEntries loaded data by source id
 * @param {{autoResolution:number, selection:object|null}} ctx
 * @returns {{layers: object[], errors: {layerId:string, error:Error}[], prepared: Record<string, object>}}
 */
export function buildDeckLayers(configs, sourceEntries, ctx) {
  const layers = []
  const errors = []
  const prepared = {}
  for (const config of configs) {
    if (!config.visible) continue
    const type = getLayerType(config.type)
    if (!type) {
      errors.push({ layerId: config.id, error: new Error(`Unknown layer type "${config.type}"`) })
      continue
    }
    // Sourceless layers (XYZ, WMS) carry their service in the style and need no loaded data.
    const entry = type.sourceless ? { status: 'ready', data: null } : sourceEntries[config.sourceId]
    if (entry?.status !== 'ready') continue
    try {
      const p = prepareLayer(type, config, entry.data, ctx)
      prepared[config.id] = p
      layers.push(...type.createDeckLayers(config, p, ctx))
    } catch (error) {
      errors.push({ layerId: config.id, error })
    }
  }
  return { layers, errors, prepared }
}
