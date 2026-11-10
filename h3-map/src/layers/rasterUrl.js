// Pure helpers for web-map layers (XYZ tiles, WMS). No deck.gl, no React.

/** Problem with an http(s) URL, or null. */
export function urlProblem(value) {
  if (typeof value !== 'string' || !value.trim()) return 'Enter a URL.'
  let url
  try {
    url = new URL(value.trim().replace(/\{[^}]*\}/g, '0'))
  } catch {
    return 'Not a valid URL.'
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? null : 'Only http(s) URLs are supported.'
}

/** Problem with an XYZ template, or null. It needs {z}, {x} and {y} (or {-y} for TMS). */
export function xyzProblem(template) {
  const base = urlProblem(template)
  if (base) return base
  const t = String(template)
  if (!t.includes('{z}') || !t.includes('{x}') || !(t.includes('{y}') || t.includes('{-y}'))) {
    return 'The tile URL must contain {z}, {x} and {y}, e.g. https://tile.openstreetmap.org/{z}/{x}/{y}.png'
  }
  return null
}

/**
 * Expand subdomain placeholders into several templates (deck.gl spreads requests over the list):
 * `{s}` -> a, b, c and `{a-d}` style ranges. A template without them is returned as a one-item list.
 */
export function expandTileUrl(template) {
  const t = String(template).trim()
  const range = /\{([a-z0-9])-([a-z0-9])\}/i.exec(t)
  if (range) {
    const [, from, to] = range
    const out = []
    for (let c = from.charCodeAt(0); c <= to.charCodeAt(0) && out.length < 8; c++) out.push(t.replace(range[0], String.fromCharCode(c)))
    return out.length ? out : [t]
  }
  if (t.includes('{s}')) return ['a', 'b', 'c'].map((s) => t.replace(/\{s\}/g, s))
  return [t]
}

/** "roads, water" -> ['roads','water'] */
export function parseLayerList(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** WMS GetLegendGraphic URL for the first layer, or null. */
export function legendGraphicUrl(serviceUrl, layers) {
  const [layer] = parseLayerList(layers)
  if (!layer || urlProblem(serviceUrl)) return null
  const url = new URL(serviceUrl.trim())
  url.searchParams.set('service', 'WMS')
  url.searchParams.set('request', 'GetLegendGraphic')
  url.searchParams.set('format', 'image/png')
  url.searchParams.set('layer', layer)
  if (!url.searchParams.has('version')) url.searchParams.set('version', '1.1.1')
  return url.href
}

/** Host name for display, '' when the URL is not parseable. */
export function hostOf(value) {
  try {
    return new URL(String(value).replace(/\{[^}]*\}/g, '0')).host
  } catch {
    return ''
  }
}
