// Exported as `_WMSLayer` (experimental API) by deck.gl 9.4
import { _WMSLayer as WMSLayer } from '@deck.gl/geo-layers'
import { hostOf, legendGraphicUrl, parseLayerList, urlProblem } from '../rasterUrl.js'

/** WMS (OGC Web Map Service) image layer: deck.gl WMSLayer requests GetMap images for the current view. No data source. */
export default {
  id: 'wms',
  label: 'WMS',
  icon: 'raster',
  description: 'Map images from an OGC WMS service.',
  sourceless: true,
  geometry: [],
  defaults: () => ({ url: '', layers: '', srs: 'EPSG:3857', attribution: '' }),
  controls: [
    { key: 'url', type: 'text', label: 'Service URL', placeholder: 'https://…/wms', group: 'data' },
    { key: 'layers', type: 'text', label: 'WMS layer names (comma separated)', placeholder: 'roads,water', group: 'data' },
    { key: 'srs', type: 'select', label: 'Request CRS', options: [{ value: 'EPSG:3857', label: 'EPSG:3857 (Web Mercator)' }, { value: 'EPSG:4326', label: 'EPSG:4326 (lon/lat)' }], group: 'data' },
    { key: 'attribution', type: 'text', label: 'Attribution', placeholder: '© Data provider', group: 'data' },
  ],
  validate: (style) => urlProblem(style.url) ?? (parseLayerList(style.layers).length ? null : 'Enter at least one WMS layer name.'),
  prepareKey: (config) => `${config.style.url}|${config.style.layers}`,
  prepare: (config) => ({ layers: parseLayerList(config.style.layers) }),
  createDeckLayers(config, { layers }, ctx) {
    const s = config.style
    const report = (what) => (...args) => {
      const error = args.find((a) => a instanceof Error)
      ctx?.reportError?.(config.id, `WMS "${config.name}": ${what}${error?.message ? ` (${error.message})` : ''}. Check the service URL, layer names and CORS support.`)
    }
    return [
      new WMSLayer({
        id: config.id,
        data: s.url.trim(),
        serviceType: 'wms',
        layers,
        srs: s.srs,
        opacity: config.opacity,
        pickable: false,
        onImageLoadError: report('an image failed to load'),
        onMetadataLoadError: () => {}, // GetCapabilities is optional; GetMap errors are reported above
      }),
    ]
  },
  attribution: (config) => config.style.attribution || null,
  describe: (_object, config) => ({
    title: config.name,
    sections: [{ title: 'WMS service', rows: [['Type', 'WMS'], ['Host', hostOf(config.style.url) || '–'], ['URL', config.style.url], ['Layers', config.style.layers || '–'], ['Request CRS', config.style.srs], ['Attribution', config.style.attribution || '–']] }],
  }),
  legend: (config) => {
    const image = legendGraphicUrl(config.style.url, config.style.layers)
    return image ? { kind: 'image', title: config.name, src: image } : { kind: 'note', title: config.name, text: `WMS · ${hostOf(config.style.url) || 'web'}` }
  },
}
