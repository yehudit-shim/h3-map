// Helpers shared by layer type plugins. Layer plugins must not import React or state stores.
import { numericExtent } from '../lib/geo.js'
import { formatNumber } from '../lib/format.js'
import { createCategoricalScale, createColorScale } from '../styling/colorScale.js'
import { RAMP_OPTIONS } from '../styling/colorRamps.js'

export const HIGHLIGHT_COLOR = [255, 255, 255, 70]

export const COLOR_MODE_OPTIONS = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'quantile', label: 'Quantile classes' },
  { value: 'equal', label: 'Equal-interval classes' },
]

/** Attributes worth styling by (the id column is excluded). `types`: 'number' (default) or 'any'. */
export function fieldsOf(source, types = 'number') {
  if (!source) return []
  return source.fields.filter((f) => f.name !== 'id' && (types === 'any' || f.type === 'number'))
}

export const valueFieldsOf = (source) => fieldsOf(source, 'number')

export function fieldType(source, name) {
  return source?.fields.find((f) => f.name === name)?.type
}

export function defaultValueField(source, prefer = 'value') {
  const fields = valueFieldsOf(source)
  return (fields.find((f) => f.name === prefer) ?? fields[0])?.name ?? null
}

const isNumericColor = (s, src) => !!s.colorBy && fieldType(src, s.colorBy) === 'number'

/**
 * Standard "color by attribute" controls (schema-driven style panel). Numeric attributes get a ramp
 * and classification; text attributes get a categorical palette (no extra controls).
 * @param {string} noneLabel label for the "no attribute" option
 */
export function colorByControls(noneLabel = 'Single color', label = 'Color by') {
  return [
    { key: 'colorBy', type: 'field', fieldTypes: 'any', label, noneLabel, group: 'appearance' },
    { key: 'ramp', type: 'ramp', label: 'Color ramp', group: 'appearance', showIf: isNumericColor },
    { key: 'colorMode', type: 'select', label: 'Classification', options: COLOR_MODE_OPTIONS, group: 'appearance', showIf: isNumericColor },
    { key: 'classes', type: 'range', label: 'Classes', min: 3, max: 9, step: 1, group: 'appearance', showIf: (s, src) => isNumericColor(s, src) && s.colorMode !== 'continuous' },
    { key: 'reverse', type: 'switch', label: 'Reverse ramp', group: 'appearance', showIf: isNumericColor },
  ]
}

export const COLOR_BY_DEFAULTS = { ramp: 'viridis', colorMode: 'continuous', classes: 5, reverse: false }
export { RAMP_OPTIONS }

export function colorByKey(style) {
  return `${style.colorBy}|${style.ramp}|${style.colorMode}|${style.classes}|${style.reverse}`
}

/** Colour scale for items by an attribute (numeric ramp or categorical palette), or null if not colored by an attribute. */
export function scaleFromItems(style, items, valueOf, source) {
  if (!style.colorBy) return null
  const values = items.map(valueOf)
  if (fieldType(source, style.colorBy) === 'string') return createCategoricalScale({ values })
  return createColorScale({ ramp: style.ramp, values, mode: style.colorMode, classes: style.classes, reverse: style.reverse })
}

export function extentOf(items, valueOf) {
  return numericExtent(items, valueOf)
}

/** Convert a property bag to inspector rows. */
export function propertyRows(properties = {}, limit = 16) {
  return Object.entries(properties)
    .slice(0, limit)
    .map(([k, v]) => [k, typeof v === 'number' ? formatNumber(v) : v == null ? '–' : String(v)])
}

export function featureDescribe(properties = {}, fallbackTitle = 'Feature') {
  const title = properties.name ?? (properties.id != null ? `${fallbackTitle} #${properties.id}` : fallbackTitle)
  return { title: String(title), sections: [{ title: 'Attributes', rows: propertyRows(properties) }] }
}

export function swatchLegend(title, color) {
  return { kind: 'swatch', title, color }
}

export function scaleLegend(title, field, scale) {
  return { kind: 'scale', title, field, meta: scale.meta }
}

/** Compose a serialisable cache key for the parts of a style that affect prepared data. */
export function keyOf(...parts) {
  return parts.map((p) => (typeof p === 'object' ? JSON.stringify(p) : String(p))).join('|')
}
