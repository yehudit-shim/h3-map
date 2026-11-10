import { H3HexagonLayer } from '@deck.gl/geo-layers'
import { formatArea, formatCoord, formatNumber } from '../../lib/format.js'
import { H3_MAX_RES, describeCell } from '../../h3/h3Utils.js'
import { createColorScale, createNormalizer } from '../../styling/colorScale.js'
import { hexToRgba } from '../../styling/colorRamps.js'
import { rgbaCss } from '../../styling/cssColor.js'
import { COLOR_BY_DEFAULTS, COLOR_MODE_OPTIONS, HIGHLIGHT_COLOR, keyOf, scaleLegend } from '../common.js'

/**
 * H3 cells computed by the database: either an existing H3 table (/h3/cells) or a point table aggregated on the
 * server (/h3/aggregate). The data source returns `{cells:[{h3,value,count}], resolution, requested, coarsened}` for
 * the current viewport; this plugin only colours and draws them. (Contrast with the `h3` type, which bins GeoJSON
 * points in the browser, and with `hexagon`, which is not H3.)
 */
export default {
  id: 'h3cells',
  label: 'H3 cells (database)',
  icon: 'h3',
  description: 'H3 cells served by the database for the current view, drawn with H3HexagonLayer.',
  dataKind: 'h3cells',
  geometry: ['h3'],
  defaults: () => ({ ...COLOR_BY_DEFAULTS, resolutionMode: 'auto', resolution: 8, coverage: 0.95, outline: true, outlineColor: '#ffffff', extruded: false, maxHeight: 1500 }),
  controls: [
    { key: 'resolutionMode', type: 'segmented', label: 'Resolution', options: [{ value: 'auto', label: 'Auto (zoom)' }, { value: 'fixed', label: 'Fixed' }], group: 'data' },
    { key: 'resolution', type: 'range', label: 'H3 resolution', min: 0, max: H3_MAX_RES, step: 1, group: 'data', showIf: (s) => s.resolutionMode === 'fixed' },
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
  /** Request parameters of a dynamic source for this layer (the host re-requests when they change). */
  viewParams: (config, ctx) => ({ resolution: config.style.resolutionMode === 'auto' ? ctx.autoResolution : config.style.resolution }),
  prepareKey: (config) => keyOf(config.style.ramp, config.style.colorMode, config.style.classes, config.style.reverse),
  prepare(config, data, ctx) {
    const s = config.style
    const cells = data.cells ?? []
    const scale = createColorScale({ ramp: s.ramp, values: cells.map((c) => c.value), mode: s.colorMode, classes: s.classes, reverse: s.reverse })
    const h3 = ctx.source?.h3 ?? {}
    const metric = h3.valueColumn ? `${h3.agg ?? 'count'} of ${h3.valueColumn}` : 'count'
    return { cells, resolution: data.resolution, requested: data.requested ?? data.resolution, coarsened: !!data.coarsened, scale, metric, heightNorm: createNormalizer(scale.meta.domain) }
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
          data: (sel.cells ?? [{ h3: sel.h3 }]).map((c) => ({ h3: c.h3 })),
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
    const rows = [
      ['H3 index', c.h3],
      ['Resolution', String(c.resolution)],
      [prepared?.metric ?? 'Value', object.value == null ? '–' : formatNumber(object.value)],
      ['Rows in cell', object.count == null ? '–' : formatNumber(object.count)],
    ]
    return {
      title: `H3 cell · res ${c.resolution}`,
      kind: 'h3',
      h3: c.h3,
      resolution: c.resolution,
      sections: [
        { title: 'Cell', rows },
        { title: 'H3 properties', rows: [['Center (lat, lon)', `${formatCoord(c.center.lat)}, ${formatCoord(c.center.lon)}`], ['Area', formatArea(c.areaM2)], ['Pentagon', c.isPentagon ? 'yes' : 'no'], ['Parent (res ' + (c.resolution - 1) + ')', c.parent ?? '–']] },
      ],
      swatch: prepared ? rgbaCss(prepared.scale(object.value)) : undefined,
    }
  },
  info: (prepared) => ({ resolution: prepared.resolution, requested: prepared.requested, cellCount: prepared.cells.length, domain: prepared.scale.meta.domain }),
  legend: (config, { scale, resolution, metric }) => ({ ...scaleLegend(config.name, metric, scale), subtitle: `H3 resolution ${resolution}` }),
}
