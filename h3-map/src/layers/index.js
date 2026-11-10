// Registers the built-in layer types and exposes the public API of the layer system.
import { getLayerType, registerLayerType } from './registry.js'
import point from './types/point.js'
import line from './types/line.js'
import polygon from './types/polygon.js'
import scatterplot from './types/scatterplot.js'
import heatmap from './types/heatmap.js'
import hexagon from './types/hexagon.js'
import h3 from './types/h3.js'
import geojson from './types/geojson.js'

const BUILTIN = [point, line, polygon, scatterplot, heatmap, hexagon, h3, geojson]

for (const type of BUILTIN) {
  if (!getLayerType(type.id)) registerLayerType(type)
}

export { compatibleLayerTypes, getLayerType, listLayerTypes, registerLayerType } from './registry.js'
export { buildDeckLayers, forgetLayer } from './buildDeckLayers.js'
export { createLayerConfig } from './layerFactory.js'
