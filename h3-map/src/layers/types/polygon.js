import { PolygonLayer } from '@deck.gl/layers'
import { featuresToPolygons } from '../../lib/geo.js'
import { createNormalizer } from '../../styling/colorScale.js'
import { hexToRgba } from '../../styling/colorRamps.js'
import {
  COLOR_BY_DEFAULTS, HIGHLIGHT_COLOR, colorByControls, colorByKey, defaultValueField,
  extentOf, featureDescribe, keyOf, scaleFromItems, scaleLegend, swatchLegend,
} from '../common.js'

/** PolygonLayer: Polygon / MultiPolygon features, optional choropleth and 3D extrusion. */
export default {
  id: 'polygon',
  label: 'Polygons',
  icon: 'polygon',
  description: 'Filled polygons: single color or choropleth, optional extrusion.',
  geometry: ['polygon'],
  defaults: (source) => ({
    ...COLOR_BY_DEFAULTS,
    ramp: 'YlGnBu',
    colorBy: defaultValueField(source, 'population'),
    fillColor: '#4c8dff',
    strokeColor: '#ffffff',
    strokeWidth: 1,
    extruded: false,
    heightBy: defaultValueField(source, 'population'),
    maxHeight: 2500,
  }),
  controls: [
    ...colorByControls(),
    { key: 'fillColor', type: 'color', label: 'Fill color', group: 'appearance', showIf: (s) => !s.colorBy },
    { key: 'strokeColor', type: 'color', label: 'Outline color', group: 'appearance' },
    { key: 'strokeWidth', type: 'range', label: 'Outline width (px)', min: 0, max: 4, step: 0.5, group: 'appearance' },
    { key: 'extruded', type: 'switch', label: '3D extrusion', group: 'appearance' },
    { key: 'heightBy', type: 'field', label: 'Height by', noneLabel: 'Constant', group: 'appearance', showIf: (s) => s.extruded },
    { key: 'maxHeight', type: 'range', label: 'Max height (m)', min: 100, max: 8000, step: 100, group: 'appearance', showIf: (s) => s.extruded },
  ],
  prepareKey: (config) => keyOf(colorByKey(config.style), config.style.heightBy),
  prepare(config, data, ctx) {
    const items = featuresToPolygons(data)
    const s = config.style
    const colorOf = (d) => d.properties[s.colorBy]
    return {
      items,
      scale: scaleFromItems(s, items, colorOf, ctx.source),
      heightNorm: s.heightBy ? createNormalizer(extentOf(items, (d) => d.properties[s.heightBy])) : null,
    }
  },
  createDeckLayers(config, { items, scale, heightNorm }) {
    const s = config.style
    const fill = hexToRgba(s.fillColor, 190)
    return [
      new PolygonLayer({
        id: config.id,
        data: items,
        getPolygon: (d) => d.polygon,
        getFillColor: scale ? (d) => scale(d.properties[s.colorBy]) : fill,
        getLineColor: hexToRgba(s.strokeColor, 255),
        getLineWidth: s.strokeWidth,
        lineWidthUnits: 'pixels',
        stroked: s.strokeWidth > 0,
        filled: true,
        extruded: s.extruded,
        getElevation: s.extruded && heightNorm && s.heightBy ? (d) => heightNorm(d.properties[s.heightBy]) * s.maxHeight : s.maxHeight / 2,
        opacity: config.opacity,
        pickable: true,
        autoHighlight: true,
        highlightColor: HIGHLIGHT_COLOR,
        updateTriggers: {
          getFillColor: [scale, s.fillColor],
          getElevation: [heightNorm, s.heightBy, s.maxHeight, s.extruded],
        },
      }),
    ]
  },
  describe: (object) => featureDescribe(object.properties, 'Polygon'),
  legend: (config, { scale }) => (scale ? scaleLegend(config.name, config.style.colorBy, scale) : swatchLegend(config.name, config.style.fillColor)),
}
