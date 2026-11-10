import { HeatmapLayer } from '@deck.gl/aggregation-layers'
import { featuresToPoints } from '../../lib/geo.js'
import { rampColorRange } from '../../styling/colorRamps.js'
import { RAMP_OPTIONS, defaultValueField } from '../common.js'

/** HeatmapLayer: GPU kernel density of points, optionally weighted by a numeric attribute. */
export default {
  id: 'heatmap',
  label: 'Heatmap',
  icon: 'heatmap',
  description: 'Kernel density surface (GPU).',
  geometry: ['point'],
  defaults: (source) => ({ ramp: 'magma', reverse: false, radiusPixels: 35, intensity: 1, threshold: 0.05, weightBy: defaultValueField(source) }),
  controls: [
    { key: 'weightBy', type: 'field', label: 'Weight by', noneLabel: 'Each point = 1', group: 'data' },
    { key: 'ramp', type: 'select', label: 'Color ramp', options: RAMP_OPTIONS, group: 'appearance' },
    { key: 'reverse', type: 'switch', label: 'Reverse ramp', group: 'appearance' },
    { key: 'radiusPixels', type: 'range', label: 'Radius (px)', min: 5, max: 100, step: 1, group: 'appearance' },
    { key: 'intensity', type: 'range', label: 'Intensity', min: 0.1, max: 5, step: 0.1, group: 'appearance' },
    { key: 'threshold', type: 'range', label: 'Threshold', min: 0.01, max: 0.5, step: 0.01, group: 'appearance' },
  ],
  prepareKey: () => 'static',
  prepare: (config, data) => ({ items: featuresToPoints(data) }),
  createDeckLayers(config, { items }) {
    const s = config.style
    return [
      new HeatmapLayer({
        id: config.id,
        data: items,
        getPosition: (d) => d.position,
        getWeight: s.weightBy ? (d) => d.properties[s.weightBy] ?? 0 : 1,
        radiusPixels: s.radiusPixels,
        intensity: s.intensity,
        threshold: s.threshold,
        colorRange: rampColorRange(s.ramp, 6, s.reverse),
        opacity: config.opacity,
        pickable: false,
        updateTriggers: { getWeight: [s.weightBy] },
      }),
    ]
  },
  legend: (config) => ({ kind: 'gradient', title: config.name, ramp: config.style.ramp, reverse: config.style.reverse, labels: ['Low density', 'High density'] }),
}
