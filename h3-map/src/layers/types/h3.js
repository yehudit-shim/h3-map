import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { featuresToPoints } from '../../lib/geo.js'
import { formatArea, formatCoord, formatNumber } from '../../lib/format.js'
import { H3_MAX_RES, aggregateToH3, describeCell } from '../../h3/h3Utils.js'
import { createColorScale, createNormalizer } from '../../styling/colorScale.js'
import { hexToRgba } from '../../styling/colorRamps.js'
import { rgbaCss } from '../../styling/cssColor.js'
import { COLOR_BY_DEFAULTS, COLOR_MODE_OPTIONS, HIGHLIGHT_COLOR, defaultValueField, keyOf, scaleLegend } from '../common.js'

const AGGREGATIONS = [
  { value: 'count', label: 'Count of points' },
  { value: 'avg', label: 'Average of field' },
  { value: 'sum', label: 'Sum of field' },
  { value: 'min', label: 'Minimum of field' },
  { value: 'max', label: 'Maximum of field' },
]

// Point extraction is the expensive part of re-aggregating at a new resolution: do it once per dataset.
const pointsCache = new WeakMap()
function pointsOf(data) {
  let p = pointsCache.get(data)
  if (!p) {
    p = featuresToPoints(data)
    pointsCache.set(data, p)
  }
  return p
}

export function effectiveResolution(style, ctx) {
  return style.resolutionMode === 'auto' ? ctx.autoResolution : style.resolution
}

/**
 * H3 grid: REAL Uber H3 cells (h3-js indexes) drawn with deck.gl H3HexagonLayer.
 * Points are binned with h3-js `latLngToCell` at the selected resolution; the metric is coloured
 * with a ramp. (Contrast with the generic "Hex bin" layer, which is not H3.)
 */
export default {
  id: 'h3',
  label: 'H3 grid',
  icon: 'h3',
  description: 'Uber H3 cells aggregated from points, drawn with H3HexagonLayer.',
  geometry: ['point'],
  defaults: (source) => ({
    ...COLOR_BY_DEFAULTS,
    resolutionMode: 'auto',
    resolution: 8,
    aggregation: 'avg',
    valueField: defaultValueField(source),
    coverage: 0.95,
    outline: true,
    outlineColor: '#ffffff',
    extruded: false,
    maxHeight: 1500,
  }),
  controls: [
    { key: 'resolutionMode', type: 'segmented', label: 'Resolution', options: [{ value: 'auto', label: 'Auto (zoom)' }, { value: 'fixed', label: 'Fixed' }], group: 'data' },
    { key: 'resolution', type: 'range', label: 'H3 resolution', min: 0, max: H3_MAX_RES, step: 1, group: 'data', showIf: (s) => s.resolutionMode === 'fixed' },
    { key: 'aggregation', type: 'select', label: 'Aggregate', options: AGGREGATIONS, group: 'data' },
    { key: 'valueField', type: 'field', label: 'Value field', group: 'data', required: true, showIf: (s) => s.aggregation !== 'count' },
    { key: 'ramp', type: 'ramp', label: 'Color ramp', group: 'appearance' },
    { key: 'colorMode', type: 'select', label: 'Classification', options: COLOR_MODE_OPTIONS, group: 'appearance' },
    { key: 'classes', type: 'range', label: 'Classes', min: 3, max: 9, step: 1, group: 'appearance', showIf: (s) => s.colorMode !== 'continuous' },
    { key: 'reverse', type: 'switch', label: 'Reverse ramp', group: 'appearance' },
    { key: 'coverage', type: 'range', label: 'Cell coverage', min: 0.5, max: 1, step: 0.05, group: 'appearance' },
    { key: 'outline', type: 'switch', label: 'Cell outline', group: 'appearance' },
    { key: 'outlineColor', type: 'color', label: 'Outline color', group: 'appearance', showIf: (s) => s.outline },
    { key: 'extruded', type: 'switch', label: '3D extrusion', group: 'appearance' },
    { key: 'maxHeight', type: 'range', label: 'Max height (m)', min: 100, max: 8000, step: 100, group: 'appearance', showIf: (s) => s.extruded },
  ],
  prepareKey: (config, ctx) => {
    const s = config.style
    return keyOf(effectiveResolution(s, ctx), s.aggregation, s.aggregation === 'count' ? '' : s.valueField, s.ramp, s.colorMode, s.classes, s.reverse)
  },
  prepare(config, data, ctx) {
    const s = config.style
    const resolution = effectiveResolution(s, ctx)
    const cells = aggregateToH3(pointsOf(data), resolution, {
      aggregation: s.aggregation,
      valueField: s.aggregation === 'count' ? undefined : s.valueField,
    })
    const values = cells.map((c) => c.value)
    const scale = createColorScale({ ramp: s.ramp, values, mode: s.colorMode, classes: s.classes, reverse: s.reverse })
    return { cells, resolution, scale, heightNorm: createNormalizer(scale.meta.domain) }
  },
  createDeckLayers(config, { cells, resolution, scale, heightNorm }, ctx) {
    const s = config.style
    const layers = [
      new H3HexagonLayer({
        id: config.id,
        data: cells,
        getHexagon: (d) => d.h3,
        getFillColor: (d) => scale(d.value),
        getElevation: (d) => heightNorm(d.value) * s.maxHeight,
        extruded: s.extruded,
        filled: true,
        stroked: s.outline,
        getLineColor: hexToRgba(s.outlineColor ?? '#ffffff', 90),
        lineWidthMinPixels: 1,
        coverage: s.coverage,
        highPrecision: 'auto',
        opacity: config.opacity,
        pickable: true,
        autoHighlight: true,
        highlightColor: HIGHLIGHT_COLOR,
        updateTriggers: { getFillColor: [scale], getElevation: [heightNorm, s.maxHeight] },
      }),
    ]
    const sel = ctx.selection
    if (sel?.layerId === config.id && sel.h3 && sel.resolution === resolution) {
      layers.push(
        new H3HexagonLayer({
          id: `${config.id}::selection`,
          data: [{ h3: sel.h3 }],
          getHexagon: (d) => d.h3,
          filled: false,
          stroked: true,
          extruded: false,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 3,
          highPrecision: 'auto',
          pickable: false,
          opacity: 1,
        }),
      )
    }
    return layers
  },
  describe(object, config, prepared) {
    const c = describeCell(object.h3)
    const s = config.style
    const metric = s.aggregation === 'count' ? 'Point count' : `${s.aggregation} of ${s.valueField}`
    const rows = [
      ['H3 index', c.h3],
      ['Resolution', String(c.resolution)],
      [metric, formatNumber(object.value)],
      ['Points in cell', formatNumber(object.count)],
    ]
    return {
      title: `H3 cell · res ${c.resolution}`,
      kind: 'h3',
      h3: c.h3,
      resolution: c.resolution,
      sections: [
        { title: 'Cell', rows },
        {
          title: 'H3 properties',
          rows: [
            ['Center (lat, lon)', `${formatCoord(c.center.lat)}, ${formatCoord(c.center.lon)}`],
            ['Area', formatArea(c.areaM2)],
            ['Pentagon', c.isPentagon ? 'yes' : 'no'],
            ['Base cell', String(c.baseCell)],
            ['Parent (res ' + (c.resolution - 1) + ')', c.parent ?? '–'],
            ['Children (res ' + (c.resolution + 1) + ')', c.childrenCount ? formatNumber(c.childrenCount) : '–'],
          ],
        },
      ],
      swatch: prepared ? rgbaCss(prepared.scale(object.value)) : undefined,
    }
  },
  info: (prepared) => ({ resolution: prepared.resolution, cellCount: prepared.cells.length, domain: prepared.scale.meta.domain }),
  legend: (config, { scale, resolution }) => ({
    ...scaleLegend(config.name, config.style.aggregation === 'count' ? 'point count' : `${config.style.aggregation} ${config.style.valueField}`, scale),
    subtitle: `H3 resolution ${resolution}`,
  }),
}

