import { PathLayer } from '@deck.gl/layers'
import { featuresToPaths } from '../../lib/geo.js'
import { hexToRgba } from '../../styling/colorRamps.js'
import {
  COLOR_BY_DEFAULTS, HIGHLIGHT_COLOR, colorByControls, colorByKey, featureDescribe, scaleFromItems, scaleLegend, swatchLegend,
} from '../common.js'

/**
 * LineLayer: LineString / MultiLineString features.
 * Uses deck.gl PathLayer (multi-vertex polylines). deck.gl's own `LineLayer` only draws
 * two-point segments, which is not what GIS line data needs.
 */
export default {
  id: 'line',
  label: 'Lines',
  icon: 'line',
  description: 'Polylines: single color or colored by an attribute, constant pixel width.',
  geometry: ['line'],
  defaults: () => ({ ...COLOR_BY_DEFAULTS, colorBy: null, color: '#f2b84b', width: 3, rounded: true }),
  controls: [
    ...colorByControls(),
    { key: 'color', type: 'color', label: 'Line color', group: 'appearance', showIf: (s) => !s.colorBy },
    { key: 'width', type: 'range', label: 'Line width (px)', min: 1, max: 16, step: 0.5, group: 'appearance' },
    { key: 'rounded', type: 'switch', label: 'Rounded joins', group: 'appearance' },
  ],
  prepareKey: (config) => colorByKey(config.style),
  prepare(config, data, ctx) {
    const items = featuresToPaths(data)
    return { items, scale: scaleFromItems(config.style, items, (d) => d.properties[config.style.colorBy], ctx.source) }
  },
  createDeckLayers(config, { items, scale }) {
    const s = config.style
    return [
      new PathLayer({
        id: config.id,
        data: items,
        getPath: (d) => d.path,
        getColor: scale ? (d) => scale(d.properties[s.colorBy]) : hexToRgba(s.color, 230),
        getWidth: s.width,
        widthUnits: 'pixels',
        capRounded: s.rounded,
        jointRounded: s.rounded,
        opacity: config.opacity,
        pickable: true,
        autoHighlight: true,
        highlightColor: HIGHLIGHT_COLOR,
        updateTriggers: { getColor: [scale, s.color] },
      }),
    ]
  },
  describe: (object) => featureDescribe(object.properties, 'Line'),
  legend: (config, { scale }) => (scale ? scaleLegend(config.name, config.style.colorBy, scale) : swatchLegend(config.name, config.style.color)),
}
