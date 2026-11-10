import { BitmapLayer } from '@deck.gl/layers'
import { TileLayer } from '@deck.gl/geo-layers'
import { expandTileUrl, hostOf, xyzProblem } from '../rasterUrl.js'

/** XYZ raster tiles (slippy map `{z}/{x}/{y}` URLs): deck.gl TileLayer drawing each tile with a BitmapLayer. No data source. */
export default {
  id: 'xyz',
  label: 'XYZ tiles',
  icon: 'raster',
  description: 'Raster tiles from a {z}/{x}/{y} URL template.',
  sourceless: true,
  geometry: [],
  defaults: () => ({
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    minZoom: 0,
    maxZoom: 19,
  }),
  controls: [
    { key: 'url', type: 'text', label: 'Tile URL', placeholder: 'https://…/{z}/{x}/{y}.png', group: 'data' },
    { key: 'attribution', type: 'text', label: 'Attribution', placeholder: '© Data provider', group: 'data' },
    { key: 'minZoom', type: 'range', label: 'Min zoom', min: 0, max: 22, step: 1, group: 'appearance' },
    { key: 'maxZoom', type: 'range', label: 'Max zoom (tiles are stretched beyond)', min: 0, max: 22, step: 1, group: 'appearance' },
  ],
  validate: (style) => xyzProblem(style.url),
  prepareKey: (config) => config.style.url,
  prepare: (config) => ({ urls: expandTileUrl(config.style.url) }),
  createDeckLayers(config, { urls }, ctx) {
    const s = config.style
    return [
      new TileLayer({
        id: config.id,
        data: urls,
        minZoom: Math.min(s.minZoom, s.maxZoom),
        maxZoom: Math.max(s.minZoom, s.maxZoom),
        tileSize: 256,
        opacity: config.opacity,
        pickable: false,
        onTileError: (error) => ctx?.reportError?.(config.id, `Tiles of "${config.name}" failed to load${error?.message ? ` (${error.message})` : ''}. Check the URL and your connection.`),
        renderSubLayers: (props) => {
          const { west, south, east, north } = props.tile.bbox
          return new BitmapLayer(props, { data: null, image: props.data, bounds: [west, south, east, north] })
        },
      }),
    ]
  },
  attribution: (config) => config.style.attribution || null,
  describe: (_object, config) => ({
    title: config.name,
    sections: [{ title: 'Tile service', rows: [['Type', 'XYZ tiles'], ['Host', hostOf(config.style.url) || '–'], ['URL', config.style.url], ['Zoom range', `${config.style.minZoom}–${config.style.maxZoom}`], ['Attribution', config.style.attribution || '–']] }],
  }),
  legend: (config) => ({ kind: 'note', title: config.name, text: `Raster tiles · ${hostOf(config.style.url) || 'web'}` }),
}
