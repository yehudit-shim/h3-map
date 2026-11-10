const MAX_LAT = 85.0511

/**
 * Turn the raw map bounds into a bbox the API accepts: [minLon, minLat, maxLon, maxLat] in EPSG:4326.
 * MapLibre reports longitudes beyond +-180 once the world repeats; zoomed out far enough the box covers
 * the whole world. Returns null for unusable input. Antimeridian wrapping is not split (the view is clamped).
 * @param {number[]|null|undefined} b
 */
export function normalizeViewBbox(b) {
  if (!Array.isArray(b) || b.length !== 4 || b.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null
  let [w, s, e, n] = b
  if (e - w >= 360) {
    w = -180
    e = 180
  } else {
    // shift so the centre lies within [-180, 180], then clamp
    const centre = (w + e) / 2
    const shift = Math.round(centre / 360) * 360
    w -= shift
    e -= shift
    w = Math.max(-180, w)
    e = Math.min(180, e)
  }
  s = Math.max(-MAX_LAT, s)
  n = Math.min(MAX_LAT, n)
  if (!(w < e) || !(s < n)) return null
  return [w, s, e, n].map((v) => Math.round(v * 1e6) / 1e6)
}

/** Stable cache key for a bbox: nearly identical boxes (sub-pixel pans) share a key. */
export const bboxKey = (b, digits = 4) => (b ? b.map((v) => v.toFixed(digits)).join(',') : '')
