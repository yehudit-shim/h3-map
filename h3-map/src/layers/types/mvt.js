import { MVTLayer } from '@deck.gl/geo-layers'
import { hexToRgba } from '../../styling/colorRamps.js'
import { HIGHLIGHT_COLOR, featureDescribe, swatchLegend } from '../common.js'

/**
 * Vector tiles (MVT): a tile session of the backend (POST /connections/{id}/tiles/sessions) or a public
 * `{z}/{x}/{y}` URL. The data source hands over a tile descriptor ({urlTemplate, minzoom, maxzoom, sourceLayer,
 * getHeaders}); this plugin knows nothing about the API, the token or the store: `getHeaders()` is a closure the
 * data source created, read when the layer is built.
 * Styling is a single colour: class breaks must come from server-side stats so they are stable across tiles (P7-04).
 */
export default {
  id: 'mvt',
  label: 'Vector tiles',
  icon: 'mvt',
  description: 'Large tables streamed as Mapbox vector tiles (backend session or a public MVT URL).',
  dataKind: 'tiles',
  geometry: ['point', 'line', 'polygon', 'mixed'],
  defaults: () => ({ fillColor: '#2dd4bf', fillAlpha: 0.5, strokeColor: '#ffffff', lineWidth: 1, pointRadius: 3 }),
  controls: [
    { key: 'fillColor', type: 'color', label: 'Fill / point color', group: 'appearance' },
    { key: 'fillAlpha', type: 'range', label: 'Fill opacity', min: 0, max: 1, step: 0.05, group: 'appearance' },
    { key: 'strokeColor', type: 'color', label: 'Line / outline color', group: 'appearance' },
    { key: 'lineWidth', type: 'range', label: 'Line width (px)', min: 0, max: 10, step: 0.5, group: 'appearance' },
    { key: 'pointRadius', type: 'range', label: 'Point radius (px)', min: 1, max: 20, step: 1, group: 'appearance' },
  ],
  prepareKey: () => 'static',
  prepare: (config, tiles) => ({ tiles }),
  createDeckLayers(config, { tiles }, ctx) {
    const s = config.style
    const headers = tiles.getHeaders?.() ?? {}
    return [
      new MVTLayer({
        id: config.id,
        data: tiles.urlTemplate,
        minZoom: tiles.minzoom,
        maxZoom: tiles.maxzoom,
        // The bearer token travels in the request headers, never in the URL.
        loadOptions: { fetch: { headers } },
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
        onTileError: (error) => ctx?.reportError?.(config.id, `Tiles of "${config.name}" failed to load${error?.message ? ` (${error.message})` : ''}.`),
      }),
    ]
  },
  describe(object, config) {
    const properties = object.properties ?? {}
    const id = object.id ?? properties.id
    const d = featureDescribe(properties, config.name)
    return { ...d, featureId: id ?? null, kind: 'tile-feature' }
  },
  legend: (config) => swatchLegend(config.name, config.style.fillColor),
}
