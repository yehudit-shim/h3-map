// Pure GeoJSON helpers. No deck.gl / React imports (see layering rules in CLAUDE.md).

/** @typedef {[number, number, number, number]} Bounds  minLon, minLat, maxLon, maxLat */

const EARTH_RADIUS_KM = 6371.0088

export function haversineKm([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

function visitCoords(coords, fn) {
  if (typeof coords[0] === 'number') fn(coords)
  else for (const c of coords) visitCoords(c, fn)
}

function visitGeometry(geometry, fn) {
  if (!geometry) return
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries) visitGeometry(g, fn)
  } else if (geometry.coordinates) {
    visitCoords(geometry.coordinates, fn)
  }
}

/** Bounding box of a FeatureCollection / Feature / Geometry, or null when empty. */
export function boundsOf(geojson) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = ([x, y]) => {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (geojson.type === 'FeatureCollection') for (const f of geojson.features) visitGeometry(f.geometry, add)
  else if (geojson.type === 'Feature') visitGeometry(geojson.geometry, add)
  else visitGeometry(geojson, add)
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null
}

export function geometryClass(type) {
  switch (type) {
    case 'Point':
    case 'MultiPoint':
      return 'point'
    case 'LineString':
    case 'MultiLineString':
      return 'line'
    case 'Polygon':
    case 'MultiPolygon':
      return 'polygon'
    default:
      return 'mixed'
  }
}

/** Point / MultiPoint features -> [{position, properties}] */
export function featuresToPoints(fc) {
  const out = []
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'Point') out.push({ position: g.coordinates, properties: f.properties ?? {} })
    else if (g.type === 'MultiPoint') for (const p of g.coordinates) out.push({ position: p, properties: f.properties ?? {} })
  }
  return out
}

/** LineString / MultiLineString features -> [{path, properties}] */
export function featuresToPaths(fc) {
  const out = []
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'LineString') out.push({ path: g.coordinates, properties: f.properties ?? {} })
    else if (g.type === 'MultiLineString') for (const p of g.coordinates) out.push({ path: p, properties: f.properties ?? {} })
  }
  return out
}

/** Polygon / MultiPolygon features -> [{polygon: rings[], properties}] (multi-polygons are split). */
export function featuresToPolygons(fc) {
  const out = []
  for (const f of fc.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'Polygon') out.push({ polygon: g.coordinates, properties: f.properties ?? {} })
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) out.push({ polygon: p, properties: f.properties ?? {} })
  }
  return out
}

/** Min / max of a numeric property, ignoring non-finite values. */
export function numericExtent(items, accessor) {
  let min = Infinity, max = -Infinity
  for (const it of items) {
    const v = accessor(it)
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return Number.isFinite(min) ? [min, max] : [0, 1]
}
