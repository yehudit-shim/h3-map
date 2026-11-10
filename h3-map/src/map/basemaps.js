// Basemap registry. Providers are configuration, not code: override a style URL with an env var
// (VITE_BASEMAP_LIGHT_STYLE / VITE_BASEMAP_DARK_STYLE) to point at a self-hosted tile server
// (docs/SYSTEM_ARCHITECTURE.md §9). Defaults are CARTO's public open styles (OpenStreetMap data,
// attribution is rendered by the style). Check CARTO's terms before commercial or high-volume use.

const blankStyle = {
  version: 8,
  name: 'Blank',
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#d8dee6' } }],
}

export const BASEMAPS = [
  {
    id: 'light',
    label: 'Light',
    provider: 'CARTO Positron · © OpenStreetMap contributors',
    style: import.meta.env?.VITE_BASEMAP_LIGHT_STYLE || 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    swatch: ['#f1efe9', '#cfd8dc'],
  },
  {
    id: 'dark',
    label: 'Dark',
    provider: 'CARTO Dark Matter · © OpenStreetMap contributors',
    style: import.meta.env?.VITE_BASEMAP_DARK_STYLE || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    swatch: ['#1c1f24', '#2d3138'],
  },
  {
    id: 'blank',
    label: 'Blank',
    provider: 'No basemap',
    style: blankStyle,
    swatch: ['#d8dee6', '#c4ccd6'],
  },
]

export const DEFAULT_BASEMAP_ID = 'dark'

export function getBasemap(id) {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP_ID)
}
