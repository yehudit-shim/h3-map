import { GeoJsonLayer } from '@deck.gl/layers'
import { hexToRgba } from '../../styling/colorRamps.js'
import { HIGHLIGHT_COLOR, featureDescribe, swatchLegend } from '../common.js'

/** GeoJSONLayer: any mixed GeoJSON (points, lines, polygons) via deck.gl GeoJsonLayer. */
export default {
  id: 'geojson',
  label: 'GeoJSON',
  icon: 'geojson',
  description: 'Mixed geometry rendered as-is.',
  geometry: ['point', 'line', 'polygon', 'mixed'],
  defaults: () => ({ fillColor: '#7c5cff', strokeColor: '#ffffff', lineWidth: 2, pointRadius: 5, fillAlpha: 0.55 }),
  controls: [
    { key: 'fillColor', type: 'color', label: 'Fill / point color', group: 'appearance' },
    { key: 'fillAlpha', type: 'range', label: 'Fill opacity', min: 0, max: 1, step: 0.05, group: 'appearance' },
    { key: 'strokeColor', type: 'color', label: 'Line / outline color', group: 'appearance' },
    { key: 'lineWidth', type: 'range', label: 'Line width (px)', min: 0, max: 10, step: 0.5, group: 'appearance' },
    { key: 'pointRadius', type: 'range', label: 'Point radius (px)', min: 1, max: 20, step: 1, group: 'appearance' },
  ],
  prepareKey: () => 'static',
  prepare: (config, data) => ({ data }),
  createDeckLayers(config, { data }) {
    const s = config.style
    return [
      new GeoJsonLayer({
        id: config.id,
        data,
        filled: true,
        stroked: true,
        getFillColor: hexToRgba(s.fillColor, Math.round(s.fillAlpha * 255)),
        getLineColor: hexToRgba(s.strokeColor, 255),
        getLineWidth: s.lineWidth,
        lineWidthUnits: 'pixels',
        pointType: 'circle',
        getPointRadius: s.pointRadius,
        pointRadiusUnits: 'pixels',
        opacity: config.opacity,
        pickable: true,
        autoHighlight: true,
        highlightColor: HIGHLIGHT_COLOR,
      }),
    ]
  },
  describe: (object) => featureDescribe(object.properties, object.geometry?.type ?? 'Feature'),
  legend: (config) => swatchLegend(config.name, config.style.fillColor),
}
