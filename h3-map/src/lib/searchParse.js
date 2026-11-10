import { isValidCell } from 'h3-js'

/**
 * Parse a search box entry. Supported: "lat, lon" / "lat lon" (decimal degrees) and H3 cell indexes.
 * @returns {{kind:'coords', lat:number, lon:number} | {kind:'h3', h3:string} | null}
 */
export function parseSearch(input) {
  const text = String(input ?? '').trim()
  if (!text) return null
  if (/^[0-9a-fA-F]{15}$/.test(text) && isValidCell(text.toLowerCase())) return { kind: 'h3', h3: text.toLowerCase() }
  const m = text.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/)
  if (m) {
    const lat = Number(m[1]), lon = Number(m[2])
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { kind: 'coords', lat, lon }
  }
  return null
}
