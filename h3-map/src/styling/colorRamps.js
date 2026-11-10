// Sequential colour ramps (perceptually ordered; viridis/plasma/magma and ColorBrewer YlGnBu/YlOrRd).
// Stops are hex strings; helpers convert and interpolate in sRGB.

export const RAMPS = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  magma: ['#000004', '#180f3e', '#451077', '#721f81', '#9f2f7f', '#cd4071', '#f1605d', '#fd9567', '#feca8d', '#fcfdbf'],
  YlGnBu: ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'],
  YlOrRd: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
}

// Qualitative palette for categorical attributes (Okabe-Ito based, colour-blind safe, plus extras).
export const CATEGORICAL_PALETTE = ['#0072b2', '#e69f00', '#009e73', '#d55e00', '#cc79a7', '#56b4e9', '#f0e442', '#7b61ff', '#88cc88', '#e377c2']

export const RAMP_OPTIONS = Object.keys(RAMPS).map((id) => ({ value: id, label: id }))

export function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** hex -> [r,g,b,a] with alpha 0-255 */
export function hexToRgba(hex, alpha = 255) {
  return [...hexToRgb(hex), alpha]
}

const parsed = new Map()
function stopsOf(ramp) {
  let s = parsed.get(ramp)
  if (!s) {
    s = (RAMPS[ramp] ?? RAMPS.viridis).map(hexToRgb)
    parsed.set(ramp, s)
  }
  return s
}

/** Colour at t∈[0,1] along a ramp -> [r,g,b] */
export function sampleRamp(ramp, t, reverse = false) {
  const stops = stopsOf(ramp)
  let x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  if (reverse) x = 1 - x
  const pos = x * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(pos))
  const f = pos - i
  const a = stops[i], b = stops[i + 1]
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)]
}

/** n evenly spaced colours (as [r,g,b,a]) for layers that take a colorRange (Heatmap, HexagonLayer) */
export function rampColorRange(ramp, n = 6, reverse = false, alpha = 255) {
  return Array.from({ length: n }, (_, i) => [...sampleRamp(ramp, n === 1 ? 0.5 : i / (n - 1), reverse), alpha])
}

/** CSS linear-gradient for legends */
export function rampGradientCss(ramp, reverse = false) {
  const stops = Array.from({ length: 8 }, (_, i) => {
    const [r, g, b] = sampleRamp(ramp, i / 7, reverse)
    return `rgb(${r} ${g} ${b}) ${Math.round((i / 7) * 100)}%`
  })
  return `linear-gradient(to right, ${stops.join(', ')})`
}
