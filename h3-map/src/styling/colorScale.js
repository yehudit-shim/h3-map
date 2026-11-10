import { CATEGORICAL_PALETTE, hexToRgb, sampleRamp } from './colorRamps.js'

export const NO_DATA_COLOR = [128, 136, 148, 110]

/** Inner class breaks (classes-1 values) by equal interval over [min,max]. */
export function equalBreaks(min, max, classes) {
  const out = []
  for (let i = 1; i < classes; i++) out.push(min + ((max - min) * i) / classes)
  return out
}

/** Inner class breaks by quantiles of the values. */
export function quantileBreaks(values, classes) {
  const sorted = Float64Array.from(values.filter((v) => Number.isFinite(v))).sort()
  const n = sorted.length
  if (!n) return []
  const out = []
  for (let i = 1; i < classes; i++) {
    const pos = (i / classes) * (n - 1)
    const lo = Math.floor(pos)
    const hi = Math.min(n - 1, lo + 1)
    out.push(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo))
  }
  return out
}

function classIndex(breaks, v) {
  let i = 0
  while (i < breaks.length && v >= breaks[i]) i++
  return i
}

/**
 * Build a value -> [r,g,b,a] function with metadata for legends.
 * @param {object} o
 * @param {string} o.ramp ramp id
 * @param {number[]} o.values all numeric values (used for the domain and quantiles)
 * @param {'continuous'|'quantile'|'equal'} [o.mode]
 * @param {number} [o.classes] number of classes for quantile/equal
 * @param {boolean} [o.reverse]
 * @param {number} [o.alpha] 0-255
 */
export function createColorScale({ ramp = 'viridis', values, mode = 'continuous', classes = 5, reverse = false, alpha = 230 }) {
  let min = Infinity, max = -Infinity
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!Number.isFinite(min)) { min = 0; max = 1 }
  const nClasses = Math.max(2, Math.round(classes))
  const breaks = mode === 'quantile' ? quantileBreaks(values, nClasses) : mode === 'equal' ? equalBreaks(min, max, nClasses) : []
  const classed = mode !== 'continuous'

  const colorOfT = (t) => [...sampleRamp(ramp, t, reverse), alpha]
  const classColors = classed ? Array.from({ length: breaks.length + 1 }, (_, i) => colorOfT(breaks.length ? i / breaks.length : 0.5)) : []

  const fn = (v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return NO_DATA_COLOR
    if (classed) return classColors[classIndex(breaks, v)]
    return colorOfT(max === min ? 0.5 : (v - min) / (max - min))
  }
  fn.meta = { ramp, reverse, mode, domain: [min, max], breaks, classColors }
  return fn
}

/** Linear 0..1 normaliser over a domain (used for height / size scaling). */
export function createNormalizer([min, max]) {
  return (v) => (typeof v === 'number' && Number.isFinite(v) && max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0)
}

export const OTHER_COLOR = [150, 156, 166, 200]

/**
 * Categorical scale: the most frequent values get palette colors, the rest share an "Other" color.
 * @param {{values: unknown[], palette?: string[], maxCategories?: number, alpha?: number}} o
 */
export function createCategoricalScale({ values, palette = CATEGORICAL_PALETTE, maxCategories = palette.length, alpha = 225 }) {
  const counts = new Map()
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
  const shown = ranked.slice(0, maxCategories).map(([value]) => value)
  const colors = new Map(shown.map((v, i) => [v, [...hexToRgb(palette[i % palette.length]), alpha]]))
  const fn = (v) => (v === null || v === undefined || v === '' ? NO_DATA_COLOR : (colors.get(v) ?? OTHER_COLOR))
  fn.meta = {
    mode: 'categorical',
    categories: shown.map((value) => ({ value, color: colors.get(value), count: counts.get(value) })),
    hasOther: ranked.length > shown.length,
    domain: null,
  }
  return fn
}
