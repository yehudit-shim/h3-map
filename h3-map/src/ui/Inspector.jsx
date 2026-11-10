import { useMemo } from 'react'
import { Copy, MousePointerClick, X } from 'lucide-react'
import { MAX_CHILD_DELTA, MAX_K, describeCell, H3_MAX_RES } from '../h3/h3Utils.js'
import { OVERLAY_COLORS, overlayCells } from '../layers/h3Overlays.js'
import { formatArea, formatCoord, formatNumber } from '../lib/format.js'
import { useLayersStore } from '../state/layersStore.js'
import { notify } from '../state/notifyStore.js'
import { useSelectionStore } from '../state/selectionStore.js'
import { IconButton } from './Button.jsx'
import { Field, Select, Slider, Switch } from './controls.jsx'
import { EmptyState, Section, Spinner } from './feedback.jsx'

const rgb = (c) => `rgb(${c[0]} ${c[1]} ${c[2]})`

/** Parent / children / k-ring outlines of the selected cell(s): drawn as overlays owned by the selection. */
function OverlayControls({ selected }) {
  const overlays = useSelectionStore((s) => s.overlays)
  const set = useSelectionStore((s) => s.setOverlay)
  const res = selected.resolution
  const found = useMemo(() => overlayCells(selected.cells.map((c) => c.h3), overlays), [selected.cells, overlays])
  const maxDelta = Math.min(MAX_CHILD_DELTA, H3_MAX_RES - res)
  const row = (key, label, color, count, control) => (
    <div className="py-1">
      <Field label={label} inline>
        <span className="flex items-center gap-2">
          {overlays[key] && found[key].length > 0 && <span className="font-mono text-[11px] text-muted" data-testid={`overlay-count-${key}`}>{formatNumber(found[key].length)}</span>}
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: rgb(color) }} aria-hidden="true" />
          <Switch label={label} checked={overlays[key]} onChange={(v) => set({ [key]: v })} disabled={count === 0} />
        </span>
      </Field>
      {overlays[key] && control}
      {overlays[key] && found.problems[key] && <div className="text-[11px] text-danger" role="alert" data-testid={`overlay-problem-${key}`}>{found.problems[key]}</div>}
    </div>
  )
  return (
    <Section title="Overlays">
      {row('parent', 'Parent outline', OVERLAY_COLORS.parent, res === 0 ? 0 : 1)}
      {row('children', 'Children outlines', OVERLAY_COLORS.children, maxDelta, (
        <Field label="Levels below" htmlFor="overlay-delta" hint={`max ${MAX_CHILD_DELTA}`}>
          <Select id="overlay-delta" value={String(Math.min(overlays.childDelta, maxDelta))} onChange={(v) => set({ childDelta: Number(v) })} options={Array.from({ length: maxDelta }, (_, i) => ({ value: String(i + 1), label: `+${i + 1} → resolution ${res + i + 1}` }))} />
        </Field>
      ))}
      {row('kring', 'K-ring', OVERLAY_COLORS.kring, 1, (
        <Field label="k (rings)" hint={String(overlays.k)} htmlFor="overlay-k">
          <Slider id="overlay-k" value={overlays.k} min={1} max={MAX_K} step={1} onChange={(v) => set({ k: v })} />
        </Field>
      ))}
      <p className="mt-1 text-[11px] leading-snug text-muted">Overlays follow the selection and are cleared when the selection or the resolution changes.</p>
    </Section>
  )
}

/** Totals over several selected cells (shift-click). */
function MultiSummary({ selected, layer }) {
  const rows = useMemo(() => {
    const cells = selected.cells
    const values = cells.map((c) => c.value).filter((v) => typeof v === 'number' && Number.isFinite(v))
    const points = cells.reduce((s, c) => s + (c.count ?? 0), 0)
    const area = cells.reduce((s, c) => s + describeCell(c.h3).areaM2, 0)
    const s = layer?.style
    const metric = !s || s.aggregation === 'count' ? 'Point count' : `${s.aggregation} of ${s.valueField}`
    const total = values.reduce((a, b) => a + b, 0)
    return [
      ['Cells selected', String(cells.length)],
      ['Points in cells', formatNumber(points)],
      [`${metric}: sum`, formatNumber(total)],
      [`${metric}: mean`, values.length ? formatNumber(total / values.length) : '–'],
      [`${metric}: min`, values.length ? formatNumber(Math.min(...values)) : '–'],
      [`${metric}: max`, values.length ? formatNumber(Math.max(...values)) : '–'],
      ['Total area', formatArea(area)],
    ]
  }, [selected.cells, layer?.style])
  return (
    <Section title={`Selection summary · ${selected.cells.length} cells`}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="multi-summary">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[12px] text-muted">{k}</dt>
            <dd className="min-w-0 break-words text-right font-mono text-[12px]" data-testid={`summary-${k}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-1.5 text-[11px] text-muted">Shift-click a cell to add or remove it.</p>
    </Section>
  )
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
    notify('Copied to clipboard', { kind: 'success', timeout: 1800 })
  } catch {
    notify('Copy is not available in this browser context', { kind: 'warn' })
  }
}

/** Selected feature / H3 cell details (docs/UI_UX_DESIGN.md §7). */
export default function Inspector() {
  const selected = useSelectionStore((s) => s.selected)
  const layer = useLayersStore((s) => s.layers.find((l) => l.id === selected?.layerId))
  const layerName = layer?.name
  if (!selected) {
    return <EmptyState icon={MousePointerClick} title="Nothing selected">Click a feature or an H3 hexagon on the map to inspect it.</EmptyState>
  }
  const { detail, coordinate } = selected
  const multi = selected.cells?.length > 1
  return (
    <div data-testid="inspector">
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold" data-testid="inspector-title">{detail.title}</div>
          {layerName && <div className="truncate text-[11px] text-muted" data-testid="inspector-layer">Layer: {layerName}</div>}
          {detail.h3 && (
            <div className="mt-0.5 flex items-center gap-1">
              <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-accent" data-testid="selected-h3-index">{detail.h3}</code>
              <IconButton label="Copy H3 index" icon={Copy} size={13} className="h-6 w-6" onClick={() => copy(detail.h3)} />
            </div>
          )}
        </div>
        <IconButton label="Clear selection" icon={X} size={14} className="h-7 w-7" onClick={() => useSelectionStore.getState().clear()} />
      </div>
      {multi && <MultiSummary selected={selected} layer={layer} />}
      {detail.loading && (
        <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px] text-muted" role="status" data-testid="inspector-loading"><Spinner label="Loading attributes" /> Loading all attributes…</div>
      )}
      {detail.error && <div className="border-b border-line px-3 py-2 text-[12px] text-danger" role="alert">Could not load all attributes: {detail.error}</div>}
      {detail.sections.map((sec, i) => (
        <Section key={i} title={sec.title}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {sec.rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[12px] text-muted">{k}</dt>
                <dd className="min-w-0 break-words text-right font-mono text-[12px]" data-testid={`row-${k}`}>{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ))}
      {selected.h3 && <OverlayControls selected={selected} />}
      {coordinate && (
        <Section title="Clicked at">
          <div className="font-mono text-[12px]">{formatCoord(coordinate[1])}, {formatCoord(coordinate[0])}</div>
        </Section>
      )}
    </div>
  )
}
