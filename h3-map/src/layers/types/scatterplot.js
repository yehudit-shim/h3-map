import { ScatterplotLayer } from '@deck.gl/layers'
import { featuresToPoints } from '../../lib/geo.js'
import { createNormalizer } from '../../styling/colorScale.js'
import { hexToRgba } from '../../styling/colorRamps.js'
import {
  COLOR_BY_DEFAULTS, HIGHLIGHT_COLOR, colorByControls, colorByKey, defaultValueField,
  extentOf, featureDescribe, keyOf, scaleFromItems, scaleLegend, swatchLegend,
} from '../common.js'

/** ScatterplotLayer: attribute-driven proportional symbols (color ramp + size). */
export default {
  id: 'scatterplot',
  label: 'Scatterplot',
  icon: 'scatter',
  description: 'Points sized and colored by numeric attributes.',
  geometry: ['point'],
  defaults: (source) => ({
    ...COLOR_BY_DEFAULTS,
    ramp: 'plasma',
    colorBy: defaultValueField(source),
    fillColor: '#22b8cf',
    sizeBy: defaultValueField(source),
    minRadius: 2,
    maxRadius: 8,
  }),
  controls: [
    ...colorByControls(),
    { key: 'fillColor', type: 'color', label: 'Fill color', group: 'appearance', showIf: (s) => !s.colorBy },
    { key: 'sizeBy', type: 'field', label: 'Point size by', noneLabel: 'Constant', group: 'appearance' },
    { key: 'minRadius', type: 'range', label: 'Min radius (px)', min: 1, max: 20, step: 1, group: 'appearance' },
    { key: 'maxRadius', type: 'range', label: 'Max radius (px)', min: 1, max: 30, step: 1, group: 'appearance' },
  ],
  prepareKey: (config) => keyOf(colorByKey(config.style), config.style.sizeBy),
  prepare(config, data, ctx) {
    const items = featuresToPoints(data)
    const s = config.style
    return {
      items,
      scale: scaleFromItems(s, items, (d) => d.properties[s.colorBy], ctx.source),
      sizeNorm: s.sizeBy ? createNormalizer(extentOf(items, (d) => d.properties[s.sizeBy])) : null,
    }
  },
  createDeckLayers(config, { items, scale, sizeNorm }) {
    const s = config.style
    const lo = Math.min(s.minRadius, s.maxRadius), hi = Math.max(s.minRadius, s.maxRadius)
    return [
      new ScatterplotLayer({
        id: config.id,
        data: items,
        getPosition: (d) => d.position,
        getRadius: sizeNorm && s.sizeBy ? (d) => lo + (hi - lo) * sizeNorm(d.properties[s.sizeBy]) : (lo + hi) / 2,
        radiusUnits: 'pixels',
        getFillColor: scale ? (d) => scale(d.properties[s.colorBy]) : hexToRgba(s.fillColor, 220),
        opacity: config.opacity,
        pickable: true,
        autoHighlight: true,
        highlightColor: HIGHLIGHT_COLOR,
        updateTriggers: {
          getRadius: [sizeNorm, s.sizeBy, lo, hi],
          getFillColor: [scale, s.fillColor],
        },
      }),
    ]
  },
  describe: (object) => featureDescribe(object.properties, 'Point'),
  legend: (config, { scale }) => (scale ? scaleLegend(config.name, config.style.colorBy, scale) : swatchLegend(config.name, config.style.fillColor)),
}
