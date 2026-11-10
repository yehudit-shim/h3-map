import { useMemo } from 'react'
import { getLayerType } from '../layers/index.js'
import { formatNumber } from '../lib/format.js'
import { effectiveLayers } from '../layers/tree.js'
import { useLayersStore } from '../state/layersStore.js'
import { useRuntimeStore } from '../state/runtimeStore.js'
import { rampGradientCss } from '../styling/colorRamps.js'
import { rgbaCss } from '../styling/cssColor.js'

function LegendBody({ spec }) {
  if (spec.kind === 'swatch') {
    return <span className="inline-block h-3 w-3 rounded-sm border border-white/30" style={{ background: spec.color }} />
  }
  if (spec.kind === 'gradient') {
    return (
      <div>
        <div className="h-2.5 w-36 rounded-sm" style={{ background: rampGradientCss(spec.ramp, spec.reverse) }} />
        <div className="mt-0.5 flex justify-between text-[10px] text-muted"><span>{spec.labels[0]}</span><span>{spec.labels[1]}</span></div>
      </div>
    )
  }
  const { meta } = spec
  if (meta.mode === 'continuous') {
    const [lo, hi] = meta.domain
    return (
      <div>
        <div className="h-2.5 w-36 rounded-sm" style={{ background: rampGradientCss(meta.ramp, meta.reverse) }} />
        <div className="mt-0.5 flex justify-between font-mono text-[10px] text-muted"><span>{formatNumber(lo)}</span><span>{formatNumber(hi)}</span></div>
      </div>
    )
  }
  const edges = [meta.domain[0], ...meta.breaks, meta.domain[1]]
  return (
    <ul className="space-y-0.5">
      {meta.classColors.map((c, i) => (
        <li key={i} className="flex items-center gap-2 text-[11px]">
          <span className="h-3 w-5 rounded-sm" style={{ background: rgbaCss(c) }} />
          <span className="font-mono text-muted">{formatNumber(edges[i])} – {formatNumber(edges[i + 1])}</span>
        </li>
      ))}
    </ul>
  )
}

/** Floating legend for every visible layer. Reuses the memoised prepared data of the layer factory. */
export default function Legend() {
  const tree = useLayersStore((s) => s.tree)
  const prepared = useRuntimeStore((s) => s.prepared)
  const items = useMemo(
    () =>
      effectiveLayers(tree)
        .reverse() // top layer first, like the layer manager
        .filter((l) => l.visible && prepared[l.id])
        .map((l) => ({ layer: l, spec: getLayerType(l.type).legend?.(l, prepared[l.id]) }))
        .filter((x) => x.spec),
    [tree, prepared],
  )
  if (!items.length) return null
  return (
    <div className="max-h-[40vh] max-w-[220px] overflow-auto rounded-lg border border-line bg-panel/95 p-2.5 shadow-float backdrop-blur" aria-label="Legend" data-testid="legend">
      <ul className="space-y-2.5">
        {items.map(({ layer, spec }) => (
          <li key={layer.id}>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
              {spec.kind === 'swatch' && <LegendBody spec={spec} />}
              <span className="truncate">{layer.name}</span>
            </div>
            {spec.field && <div className="mb-1 text-[10px] text-muted">{spec.field}{spec.subtitle ? ` · ${spec.subtitle}` : ''}</div>}
            {spec.kind !== 'swatch' && <LegendBody spec={spec} />}
          </li>
        ))}
      </ul>
    </div>
  )
}
