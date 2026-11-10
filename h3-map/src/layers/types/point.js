import { ScatterplotLayer } from '@deck.gl/layers'
import { featuresToPoints } from '../../lib/geo.js'
import { hexToRgba } from '../../styling/colorRamps.js'
import {
  COLOR_BY_DEFAULTS, HIGHLIGHT_COLOR, colorByControls, colorByKey, featureDescribe, scaleFromItems, scaleLegend, swatchLegend,
} from '../common.js'

/** PointLayer: uniform-size markers for Point / MultiPoint data (deck.gl ScatterplotLayer), optional color by attribute. */
export default {
  id: 'point',
  label: 'Points',
  icon: 'point',
  description: 'Point markers: single color or colored by an attribute.',
  geometry: ['point'],
  defaults: () => ({ ...COLOR_BY_DEFAULTS, colorBy: null, fillColor: '#22b8cf', strokeColor: '#ffffff', radius: 5, strokeWidth: 1 }),
  controls: [
    ...colorByControls(),
    { key: 'fillColor', type: 'color', label: 'Fill color', group: 'appearance', showIf: (s) => !s.colorBy },
    { key: 'strokeColor', type: 'color', label: 'Outline color', group: 'appearance' },
    { key: 'radius', type: 'range', label: 'Point size: radius (px)', min: 1, max: 24, step: 1, group: 'appearance' },
    { key: 'strokeWidth', type: 'range', label: 'Outline width (px)', min: 0, max: 4, step: 0.5, group: 'appearance' },
  ],
  prepareKey: (config) => colorByKey(config.style),
  prepare(config, data, ctx) {
    const items = featuresToPoints(data)
    return { items, scale: scaleFromItems(config.style, items, (d) => d.properties[config.style.colorBy], ctx.source) }
  },
  createDeckLayers(config, { items, scale }) {
    const s = config.style
    return [
      new ScatterplotLayer({
        id: config.id,
        data: items,
        getPosition: (d) => d.position,
        getRadius: s.radius,
        radiusUnits: 'pixels',
        getFillColor: scale ? (d) => scale(d.properties[s.colorBy]) : hexToRgba(s.fillColor, 235),
        getLineColor: hexToRgba(s.strokeColor, 255),
        getLineWidth: s.strokeWidth,
        lineWidthUnits: 'pixels',
        stroked: s.strokeWidth > 0,
        opacity: config.opacity,
        pickable: true,
        autoHighlight: true,
        highlightColor: HIGHLIGHT_COLOR,
        updateTriggers: { getFillColor: [scale, s.fillColor] },
      }),
    ]
  },
  describe: (object) => featureDescribe(object.properties, 'Point'),
  legend: (config, { scale }) => (scale ? scaleLegend(config.name, config.style.colorBy, scale) : swatchLegend(config.name, config.style.fillColor)),
}
