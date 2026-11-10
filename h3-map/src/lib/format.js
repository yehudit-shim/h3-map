const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const nfInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export function formatNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '–'
  return Math.abs(n) >= 1000 ? nfInt.format(n) : nf.format(n)
}

export function formatCoord(value, digits = 5) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '–'
}

export function formatArea(m2) {
  if (m2 >= 1e6) return `${nf.format(m2 / 1e6)} km²`
  return `${nf.format(m2)} m²`
}

export function formatLength(m) {
  if (m >= 1000) return `${nf.format(m / 1000)} km`
  return `${nf.format(m)} m`
}

/** Ground resolution in metres per CSS pixel at a latitude / zoom (512px tiles, MapLibre). */
export function metersPerPixel(lat, zoom) {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/** Map scale denominator for a 96 dpi screen. */
export function scaleDenominator(lat, zoom) {
  return Math.round((metersPerPixel(lat, zoom) * 96) / 0.0254)
}

export function formatScale(lat, zoom) {
  return `1:${nfInt.format(scaleDenominator(lat, zoom))}`
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
