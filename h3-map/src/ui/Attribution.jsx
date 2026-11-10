import { useMemo } from 'react'
import { getLayerType } from '../layers/index.js'
import { effectiveLayers } from '../layers/tree.js'
import { useLayersStore } from '../state/layersStore.js'

/** Credits of the visible web-map layers (XYZ, WMS): any layer type may provide `attribution(config)`. */
export default function Attribution() {
  const tree = useLayersStore((s) => s.tree)
  const credits = useMemo(() => {
    const out = new Set()
    for (const l of effectiveLayers(tree)) {
      if (!l.visible) continue
      const text = getLayerType(l.type)?.attribution?.(l)
      if (text) out.add(text)
    }
    return [...out]
  }, [tree])
  if (!credits.length) return null
  return (
    <div className="max-w-[60vw] truncate rounded bg-panel/85 px-1.5 py-0.5 text-[10px] text-muted backdrop-blur" aria-label="Map data attribution" data-testid="attribution">
      {credits.join(' · ')}
    </div>
  )
}
