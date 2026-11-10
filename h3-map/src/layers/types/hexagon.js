import { HexagonLayer } from '@deck.gl/aggregation-layers'
import { featuresToPoints } from '../../lib/geo.js'
import { rampColorRange } from '../../styling/colorRamps.js'
import { formatNumber as formatNumberSafe } from '../../lib/format.js'
import { RAMP_OPTIONS, defaultValueField } from '../common.js'

/**
 * HexagonLayer: GENERIC hexagonal binning computed by deck.gl at an arbitrary metre radius.
 * These bins are NOT Uber H3 cells: they have no index, no resolution hierarchy and cannot be
 * joined to database H3 columns. Use the "H3 grid" layer for real H3.
 */
export default {
  id: 'hexagon',
  label: 'Hex bin (generic)',
  icon: 'hexbin',
  description: 'deck.gl hexagonal binning by radius. Not H3.',
  geometry: ['point'],
  defaults: (source) => ({ ramp: 'YlOrRd', reverse: false, radius: 400, coverage: 0.9, extruded: false, elevationScale: 4, colorBy: defaultValueField(source) }),
  controls: [
    { key: 'radius', type: 'range', label: 'Bin radius (m)', min: 100, max: 3000, step: 50, group: 'data' },
    { key: 'colorBy', type: 'field', label: 'Color by (mean)', noneLabel: 'Point count', group: 'data' },
    { key: 'ramp', type: 'select', label: 'Color ramp', options: RAMP_OPTIONS, group: 'appearance' },
    { key: 'reverse', type: 'switch', label: 'Reverse ramp', group: 'appearance' },
    { key: 'coverage', type: 'range', label: 'Coverage', min: 0.2, max: 1, step: 0.05, group: 'appearance' },
    { key: 'extruded', type: 'switch', label: '3D extrusion (by count)', group: 'appearance' },
    { key: 'elevationScale', type: 'range', label: 'Height scale', min: 1, max: 40, step: 1, group: 'appearance', showIf: (s) => s.extruded },
  ],
  prepareKey: () => 'static',
  prepare: (config, data) => ({ items: featuresToPoints(data) }),
  createDeckLayers(config, { items }) {
    const s = config.style
    return [
      new HexagonLayer({
        id: config.id,
        data: items,
        getPosition: (d) => d.position,
        radius: s.radius,
        coverage: s.coverage,
        extruded: s.extruded,
        elevationScale: s.elevationScale,
        getColorWeight: s.colorBy ? (d) => d.properties[s.colorBy] ?? 0 : 1,
        colorAggregation: s.colorBy ? 'MEAN' : 'SUM',
        getElevationWeight: 1,
        elevationAggregation: 'SUM',
        colorRange: rampColorRange(s.ramp, 6, s.reverse),
        opacity: config.opacity,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 70],
        updateTriggers: { getColorWeight: [s.colorBy], colorAggregation: [s.colorBy] },
      }),
    ]
  },
  describe(object, config) {
    const rows = [['Points in bin', formatNumberSafe(object.count)]]
    if (config.style.colorBy) rows.push([`Mean ${config.style.colorBy}`, formatNumberSafe(object.colorValue)])
    if (object.position) rows.push(['Bin center', `${object.position[1].toFixed(5)}, ${object.position[0].toFixed(5)}`])
    return { title: 'Hex bin (generic, not H3)', sections: [{ rows }] }
  },
  legend: (config) => ({ kind: 'gradient', title: config.name, ramp: config.style.ramp, reverse: config.style.reverse, labels: [config.style.colorBy ? `Low ${config.style.colorBy}` : 'Few points', config.style.colorBy ? `High ${config.style.colorBy}` : 'Many points'] }),
}
