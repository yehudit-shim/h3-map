import { Hexagon } from 'lucide-react'
import { getLayerType } from '../layers/index.js'
import { getSource } from '../data/sources.js'
import { Button } from './Button.jsx'
import { useLayersStore } from '../state/layersStore.js'
import { useUiStore } from '../state/uiStore.js'
import { ControlRow, H3Readout } from './StylePanel.jsx'
import { EmptyState, Section } from './feedback.jsx'

/** Dedicated H3 controls (docs/UI_UX_DESIGN.md §6): resolution, aggregation and value field of the active H3 layer. */
export default function H3Panel() {
  const layer = useLayersStore((s) => {
    const active = s.layers.find((l) => l.id === s.activeId)
    return active?.type === 'h3' ? active : s.layers.find((l) => l.type === 'h3')
  })
  if (!layer) {
    return (
      <EmptyState icon={Hexagon} title="No H3 layer">
        <span className="block">Add an “H3 grid” layer from the Data tab to bin points into Uber H3 cells.</span>
        <Button className="mt-3" variant="outline" onClick={() => useUiStore.getState().openLeftTab('data')}>Open Data</Button>
      </EmptyState>
    )
  }
  const type = getLayerType('h3')
  const source = getSource(layer.sourceId)
  const controls = type.controls.filter((c) => c.group === 'data' && (!c.showIf || c.showIf(layer.style, source)))
  return (
    <div>
      <div className="border-b border-line px-3 py-2.5">
        <div className="truncate text-[13px] font-semibold">{layer.name}</div>
        <div className="text-[11px] text-muted">Real H3 indexes via h3-js · drawn with H3HexagonLayer</div>
      </div>
      <Section title="Resolution & aggregation">
        <H3Readout layer={layer} />
        {controls.map((c) => (
          <ControlRow key={c.key} control={c} layer={layer} source={source} />
        ))}
        <p className="mt-2 text-[11px] leading-snug text-muted">Click a hexagon to inspect its index, parent and children. In Auto mode the resolution follows the map zoom.</p>
      </Section>
    </div>
  )
}
