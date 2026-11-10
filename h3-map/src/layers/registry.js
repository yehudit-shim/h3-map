// Layer type registry. A layer type is a plugin; adding one never requires editing the map component.
//
// LayerType contract (see docs/SYSTEM_ARCHITECTURE.md §3.2):
// {
//   id, label, icon, description,
//   geometry: ('point'|'line'|'polygon'|'mixed')[]   // source geometry classes this type can draw
//   defaults(source) -> style                          // initial serialisable style
//   controls: ControlDescriptor[]                      // schema for the generated style panel
//   styleGroups?: ('data'|'appearance')[]              // groups shown in the Style panel (default: all)
//   prepareKey(config, ctx) -> string                  // changes when prepared data must be recomputed
//   prepare(config, data, ctx) -> prepared             // derive render data (memoised by the factory)
//   createDeckLayers(config, prepared, ctx) -> Layer[]
//   describe?(object, config, prepared) -> {title, sections}   // tooltip + inspector content
//   legend?(config, prepared) -> LegendSpec | null
// }

const types = new Map()
const REQUIRED = ['id', 'label', 'geometry', 'defaults', 'controls', 'prepareKey', 'prepare', 'createDeckLayers']

export function registerLayerType(type) {
  for (const key of REQUIRED) {
    if (type?.[key] === undefined) throw new Error(`Layer type is missing required field "${key}"`)
  }
  if (types.has(type.id)) throw new Error(`Layer type "${type.id}" is already registered`)
  types.set(type.id, type)
  return type
}

export function getLayerType(id) {
  return types.get(id)
}

export function listLayerTypes() {
  return [...types.values()]
}

/** Layer types able to draw a given data source. */
export function compatibleLayerTypes(source) {
  if (!source) return []
  return listLayerTypes().filter((t) => t.geometry.includes(source.geometry))
}

/** Test helper */
export function _resetRegistry() {
  types.clear()
}
