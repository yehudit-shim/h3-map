// Synthetic sample datasets around Paris (inland, so nothing lands in water).
// All generators are deterministic. They return plain GeoJSON FeatureCollections, the same
// shape the PostGIS /features endpoint will return (docs/API_SPECIFICATION.md §6).
import { haversineKm } from '../../lib/geo.js'
import { clamp, gaussian, mulberry32, round } from './random.js'

import { SAMPLE_CENTER } from '../sampleView.js'
export const SAMPLE_BBOX = [2.22, 48.8, 2.48, 48.92]

const HOTSPOTS = [
  { name: 'Louvre', c: [2.3376, 48.8606], sigma: 0.014, w: 5, base: 72 },
  { name: 'Eiffel', c: [2.2945, 48.8584], sigma: 0.012, w: 3, base: 58 },
  { name: 'Montmartre', c: [2.3431, 48.8867], sigma: 0.012, w: 3, base: 45 },
  { name: 'La Défense', c: [2.238, 48.892], sigma: 0.016, w: 3, base: 85 },
  { name: 'Bastille', c: [2.3692, 48.8531], sigma: 0.013, w: 3, base: 38 },
  { name: 'Montparnasse', c: [2.3219, 48.8421], sigma: 0.015, w: 2, base: 25 },
]
const TOTAL_W = HOTSPOTS.reduce((s, h) => s + h.w, 0)
const CATEGORIES = ['Transport', 'Retail', 'Culture', 'Food']

function pickHotspot(rand) {
  let r = rand() * TOTAL_W
  for (const h of HOTSPOTS) {
    r -= h.w
    if (r <= 0) return h
  }
  return HOTSPOTS[0]
}

const point = (coordinates, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates }, properties })
const collection = (features) => ({ type: 'FeatureCollection', features })

/** Clustered event points with a numeric `value` (0-100): used for scatter, heatmap, hex bin and H3 aggregation. */
export function generateEvents(count = 20000, seed = 42) {
  const rand = mulberry32(seed)
  const features = []
  for (let i = 0; i < count; i++) {
    let lon, lat, value
    if (rand() < 0.08) {
      lon = SAMPLE_BBOX[0] + rand() * (SAMPLE_BBOX[2] - SAMPLE_BBOX[0])
      lat = SAMPLE_BBOX[1] + rand() * (SAMPLE_BBOX[3] - SAMPLE_BBOX[1])
      value = clamp(rand() * 40, 0, 100)
    } else {
      const h = pickHotspot(rand)
      lon = h.c[0] + gaussian(rand) * h.sigma * 1.3
      lat = h.c[1] + gaussian(rand) * h.sigma
      value = clamp(h.base + gaussian(rand) * 12, 0, 100)
    }
    features.push(point([round(lon, 6), round(lat, 6)], { id: i + 1, value: round(value, 1), category: CATEGORIES[Math.floor(rand() * CATEGORIES.length)] }))
  }
  return collection(features)
}

/** Points of interest with a name, category and rating. */
export function generatePois(count = 300, seed = 7) {
  const rand = mulberry32(seed)
  const features = []
  for (let i = 0; i < count; i++) {
    const h = pickHotspot(rand)
    const lon = h.c[0] + gaussian(rand) * h.sigma * 2
    const lat = h.c[1] + gaussian(rand) * h.sigma * 1.6
    features.push(
      point([round(lon, 6), round(lat, 6)], {
        id: i + 1,
        name: `POI ${String(i + 1).padStart(3, '0')}`,
        category: CATEGORIES[Math.floor(rand() * CATEGORIES.length)],
        rating: round(1 + rand() * 4, 1),
      }),
    )
  }
  return collection(features)
}

/** Wobbly routes between hotspots (LineString) with a computed length. */
export function generateRoutes(count = 14, seed = 11) {
  const rand = mulberry32(seed)
  const classes = ['primary', 'secondary', 'tertiary']
  const features = []
  for (let i = 0; i < count; i++) {
    const a = HOTSPOTS[i % HOTSPOTS.length]
    const b = HOTSPOTS[(i + 1 + Math.floor(rand() * (HOTSPOTS.length - 1))) % HOTSPOTS.length]
    const steps = 24
    const phase = rand() * Math.PI * 2
    const amp = 0.004 + rand() * 0.006
    const dx = b.c[0] - a.c[0], dy = b.c[1] - a.c[1]
    const len = Math.hypot(dx, dy) || 1
    const coords = []
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const wobble = Math.sin(t * Math.PI * 3 + phase) * amp * Math.sin(t * Math.PI)
      coords.push([round(a.c[0] + dx * t + (-dy / len) * wobble, 6), round(a.c[1] + dy * t + (dx / len) * wobble, 6)])
    }
    let km = 0
    for (let s = 1; s < coords.length; s++) km += haversineKm(coords[s - 1], coords[s])
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: { id: i + 1, name: `Route ${i + 1}`, class: classes[i % 3], length_km: round(km, 2) },
    })
  }
  return collection(features)
}

/**
 * A jittered 6x5 grid of district polygons sharing vertices (no gaps), with population.
 * Cells 7 and 22 are merged into a single MultiPolygon to exercise multi-part geometry.
 */
export function generateDistricts(seed = 5) {
  const cols = 6, rows = 5
  const [x0, y0, x1, y1] = [2.24, 48.815, 2.44, 48.905]
  const rand = mulberry32(seed)
  const dx = (x1 - x0) / cols, dy = (y1 - y0) / rows
  const grid = []
  for (let r = 0; r <= rows; r++) {
    const row = []
    for (let c = 0; c <= cols; c++) {
      const edge = r === 0 || c === 0 || r === rows || c === cols
      const jx = edge ? 0 : (rand() - 0.5) * dx * 0.5
      const jy = edge ? 0 : (rand() - 0.5) * dy * 0.5
      row.push([round(x0 + c * dx + jx, 6), round(y0 + r * dy + jy, 6)])
    }
    grid.push(row)
  }
  const ring = (r, c) => [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c], grid[r][c]]
  const areaKm2 = (coords) => {
    const lat0 = coords[0][1]
    const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57
    let s = 0
    for (let i = 0; i < coords.length - 1; i++) s += coords[i][0] * kx * coords[i + 1][1] * ky - coords[i + 1][0] * kx * coords[i][1] * ky
    return Math.abs(s) / 2
  }
  const popOf = (r, c) => {
    const cx = x0 + (c + 0.5) * dx, cy = y0 + (r + 0.5) * dy
    const d = Math.hypot((cx - SAMPLE_CENTER[0]) / 0.1, (cy - SAMPLE_CENTER[1]) / 0.07)
    return Math.round((60000 * Math.exp(-d * d * 0.9) + 4000 + rand() * 9000) / 100) * 100
  }
  const features = []
  let id = 1
  const mergedPair = [7, 22]
  const mergedRings = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const ringCoords = ring(r, c)
      const population = popOf(r, c)
      const area = round(areaKm2(ringCoords), 2)
      if (mergedPair.includes(idx)) {
        mergedRings.push({ ringCoords, population, area })
        continue
      }
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ringCoords] },
        properties: { id: id++, name: `District ${String(idx + 1).padStart(2, '0')}`, population, area_km2: area, density: Math.round(population / area) },
      })
    }
  }
  const pop = mergedRings.reduce((s, m) => s + m.population, 0)
  const area = round(mergedRings.reduce((s, m) => s + m.area, 0), 2)
  features.push({
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: mergedRings.map((m) => [m.ringCoords]) },
    properties: { id, name: 'District 08/23 (multi-part)', population: pop, area_km2: area, density: Math.round(pop / area) },
  })
  return collection(features)
}

/** Mixed geometry collection (points + lines + polygons) for the GeoJSON layer. */
export function generateMixed() {
  return collection([
    ...generatePois(40, 3).features,
    ...generateRoutes(14, 11).features.slice(0, 4),
    ...generateDistricts(5).features.slice(0, 5),
  ])
}
