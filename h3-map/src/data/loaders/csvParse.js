// Pure CSV helpers for the points importer: column detection, type inference and GeoJSON building.
// Tokenising is done by papaparse in the parse worker (jobs.js); everything here works on rows
// (objects keyed by header) so it can be unit-tested without a worker.

const LAT_NAMES = ['lat', 'latitude', 'latdeg', 'latdd', 'ycoord', 'ycoordinate', 'pointy', 'y']
const LON_NAMES = ['lon', 'lng', 'long', 'longitude', 'londeg', 'lngdd', 'xcoord', 'xcoordinate', 'pointx', 'x']
const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
const LEADING_ZERO_RE = /^[+-]?0\d/ // "007", "01234": identifiers, not numbers

const normalise = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '')
const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''

/** Parse a coordinate cell. Accepts "48.85", " 48.85 " and the decimal-comma form "48,85". NaN when invalid. */
export function parseCoordinate(value) {
  if (typeof value === 'number') return value
  if (isBlank(value)) return NaN
  let s = String(value).trim()
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.')
  return NUMBER_RE.test(s) ? Number(s) : NaN
}

/** Share of the non-blank sample values of a column that parse as numbers inside [min, max]. */
function rangeShare(rows, column, min, max) {
  let ok = 0, total = 0
  for (const row of rows) {
    if (isBlank(row[column])) continue
    total++
    const n = parseCoordinate(row[column])
    if (Number.isFinite(n) && n >= min && n <= max) ok++
  }
  return total ? ok / total : 0
}

/**
 * Find the latitude and longitude columns by name, confirming with the values of a sample.
 * @returns {{lat:string, lon:string}|null} null when unsure: the caller then asks the user.
 */
export function detectLatLon(columns, sampleRows) {
  const find = (names) => {
    for (const wanted of names) {
      const hit = columns.find((c) => normalise(c) === wanted)
      if (hit !== undefined) return hit
    }
    return null
  }
  const lat = find(LAT_NAMES)
  const lon = find(LON_NAMES)
  if (lat === null || lon === null || lat === lon) return null
  if (rangeShare(sampleRows, lat, -90, 90) < 0.8 || rangeShare(sampleRows, lon, -180, 180) < 0.8) return null
  return { lat, lon }
}

/** 'number' when every non-blank value is numeric (identifiers with leading zeros stay text), else 'string'. */
export function inferColumnTypes(columns, rows) {
  const types = {}
  for (const c of columns) {
    let numeric = 0, other = 0
    for (const row of rows) {
      const v = row[c]
      if (isBlank(v)) continue
      const s = String(v).trim()
      if (NUMBER_RE.test(s) && !LEADING_ZERO_RE.test(s)) numeric++
      else {
        other++
        break
      }
    }
    types[c] = numeric > 0 && other === 0 ? 'number' : 'string'
  }
  return types
}

/**
 * Build a GeoJSON point collection from rows. Rows that cannot become a point are reported, not thrown.
 * @param {object[]} rows
 * @param {string[]} columns
 * @param {{lat:string, lon:string, types?:Record<string,'number'|'string'>, rowErrors?: Map<number,string>, maxBad?: number}} opts
 *   rowErrors: tokeniser problems by 0-based row index (e.g. wrong number of fields)
 * @returns {{features: object[], bad: {row:number, reason:string, values:object}[], badCount:number, badTruncated:boolean, fields:{name:string,type:string}[]}}
 */
export function buildPoints(rows, columns, { lat, lon, types: inferred, rowErrors = new Map(), maxBad = 10000 }) {
  // The coordinate columns are numeric by construction (rows that are not are rejected below).
  const types = { ...(inferred ?? inferColumnTypes(columns, rows)), [lat]: 'number', [lon]: 'number' }
  const features = []
  const bad = []
  let badCount = 0
  const reject = (index, reason, row) => {
    badCount++
    if (bad.length < maxBad) bad.push({ row: index + 1, reason, values: row })
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowProblem = rowErrors.get(i)
    if (rowProblem) {
      reject(i, rowProblem, row)
      continue
    }
    const rawLat = row[lat], rawLon = row[lon]
    if (isBlank(rawLat) || isBlank(rawLon)) {
      reject(i, `missing ${isBlank(rawLat) ? 'latitude' : 'longitude'}`, row)
      continue
    }
    const y = parseCoordinate(rawLat), x = parseCoordinate(rawLon)
    if (!Number.isFinite(y)) {
      reject(i, `latitude "${rawLat}" is not a number`, row)
      continue
    }
    if (!Number.isFinite(x)) {
      reject(i, `longitude "${rawLon}" is not a number`, row)
      continue
    }
    if (y < -90 || y > 90) {
      reject(i, `latitude ${y} is outside -90…90`, row)
      continue
    }
    if (x < -180 || x > 180) {
      reject(i, `longitude ${x} is outside -180…180`, row)
      continue
    }
    const properties = {}
    for (const c of columns) {
      const v = row[c]
      if (isBlank(v)) properties[c] = null
      else if (c === lat) properties[c] = y
      else if (c === lon) properties[c] = x
      else if (types[c] === 'number') properties[c] = Number(String(v).trim())
      else properties[c] = typeof v === 'string' ? v : String(v)
    }
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [x, y] } })
  }
  return {
    features,
    bad,
    badCount,
    badTruncated: badCount > bad.length,
    fields: columns.map((name) => ({ name, type: types[name] ?? 'string' })),
  }
}

/** Serialise bad rows as CSV text for download: original columns plus row number and reason. */
export function badRowsToCsv(bad, columns) {
  const esc = (v) => {
    const s = v === undefined || v === null ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [['row', 'reason', ...columns].map(esc).join(',')]
  for (const b of bad) lines.push([b.row, b.reason, ...columns.map((c) => b.values?.[c])].map(esc).join(','))
  return lines.join('\n')
}
