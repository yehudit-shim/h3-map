// Turns a GeoJSON point collection into typed columns (lon, lat, numeric fields) that can be handed to
// the H3 worker without copying the feature objects. Pure.

/** Largest number of numeric fields shipped to the worker. */
export const MAX_FIELD_COLUMNS = 12

/**
 * @param {{features: object[]}} data FeatureCollection (Point / MultiPoint features are used; others ignored)
 * @param {string[]} fieldNames numeric properties to extract (missing / non-numeric -> NaN)
 * @returns {{lons: Float64Array, lats: Float64Array, fields: Record<string, Float64Array>, count: number}}
 */
export function extractPointColumns(data, fieldNames = []) {
  const names = fieldNames.slice(0, MAX_FIELD_COLUMNS)
  let total = 0
  for (const f of data.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'Point') total += 1
    else if (g.type === 'MultiPoint') total += g.coordinates.length
  }
  const lons = new Float64Array(total)
  const lats = new Float64Array(total)
  const fields = Object.fromEntries(names.map((n) => [n, new Float64Array(total).fill(NaN)]))
  let k = 0
  const put = (coord, props) => {
    lons[k] = coord[0]
    lats[k] = coord[1]
    if (props) {
      for (const n of names) {
        const v = props[n]
        if (typeof v === 'number') fields[n][k] = v
      }
    }
    k++
  }
  for (const f of data.features) {
    const g = f.geometry
    if (!g) continue
    if (g.type === 'Point') put(g.coordinates, f.properties)
    else if (g.type === 'MultiPoint') for (const c of g.coordinates) put(c, f.properties)
  }
  return { lons, lats, fields, count: total }
}
