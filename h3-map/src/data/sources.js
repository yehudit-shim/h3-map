// Data source registry. A source describes *where data comes from*; layers (src/layers) describe
// *how it is drawn*. Layers reference a source by id and never import sample data directly.
//
// Every source exposes:
//   id, name, description, geometry ('point'|'line'|'polygon'|'mixed'), fields[], load(): Promise<GeoJSON FeatureCollection>
//
// PostGIS tables will be added here as another source kind (loader calling the FastAPI backend)
// without touching layer code (docs/SYSTEM_ARCHITECTURE.md §3.1, Phase 6).

/** @typedef {{name:string, type:'number'|'string'}} FieldInfo */
/**
 * @typedef {Object} DataSource
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {'sample'|'postgis'} kind
 * @property {'point'|'line'|'polygon'|'mixed'} geometry
 * @property {FieldInfo[]} fields
 * @property {() => Promise<import('geojson').FeatureCollection>} load
 */

const sample = () => import('./sample/paris.js')

/** @type {DataSource[]} */
const SOURCES = [
  {
    id: 'sample-events',
    name: 'Events (20k points)',
    description: 'Clustered synthetic events with a numeric intensity value.',
    kind: 'sample',
    geometry: 'point',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'value', type: 'number' },
      { name: 'category', type: 'string' },
    ],
    load: async () => (await sample()).generateEvents(),
  },
  {
    id: 'sample-pois',
    name: 'Points of interest',
    description: '300 named points with category and rating.',
    kind: 'sample',
    geometry: 'point',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'category', type: 'string' },
      { name: 'rating', type: 'number' },
    ],
    load: async () => (await sample()).generatePois(),
  },
  {
    id: 'sample-routes',
    name: 'Routes',
    description: '14 LineStrings between hotspots, with length in km.',
    kind: 'sample',
    geometry: 'line',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'class', type: 'string' },
      { name: 'length_km', type: 'number' },
    ],
    load: async () => (await sample()).generateRoutes(),
  },
  {
    id: 'sample-districts',
    name: 'Districts',
    description: 'Gap-free polygon grid (includes one MultiPolygon) with population.',
    kind: 'sample',
    geometry: 'polygon',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
      { name: 'population', type: 'number' },
      { name: 'area_km2', type: 'number' },
      { name: 'density', type: 'number' },
    ],
    load: async () => (await sample()).generateDistricts(),
  },
  {
    id: 'sample-mixed',
    name: 'Mixed GeoJSON',
    description: 'Points, lines and polygons in a single collection.',
    kind: 'sample',
    geometry: 'mixed',
    fields: [
      { name: 'id', type: 'number' },
      { name: 'name', type: 'string' },
    ],
    load: async () => (await sample()).generateMixed(),
  },
]

export const dataSources = SOURCES

export function getSource(id) {
  return SOURCES.find((s) => s.id === id)
}

export function numericFields(source) {
  return source ? source.fields.filter((f) => f.type === 'number') : []
}
