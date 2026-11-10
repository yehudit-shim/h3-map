import { Copy, MousePointerClick, X } from 'lucide-react'
import { formatCoord } from '../lib/format.js'
import { notify } from '../state/notifyStore.js'
import { useSelectionStore } from '../state/selectionStore.js'
import { IconButton } from './Button.jsx'
import { EmptyState, Section } from './feedback.jsx'

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
  if (!selected) {
    return <EmptyState icon={MousePointerClick} title="Nothing selected">Click a feature or an H3 hexagon on the map to inspect it.</EmptyState>
  }
  const { detail, coordinate } = selected
  return (
    <div data-testid="inspector">
      <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold" data-testid="inspector-title">{detail.title}</div>
          {detail.h3 && (
            <div className="mt-0.5 flex items-center gap-1">
              <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-accent" data-testid="selected-h3-index">{detail.h3}</code>
              <IconButton label="Copy H3 index" icon={Copy} size={13} className="h-6 w-6" onClick={() => copy(detail.h3)} />
            </div>
          )}
        </div>
        <IconButton label="Clear selection" icon={X} size={14} className="h-7 w-7" onClick={() => useSelectionStore.getState().clear()} />
      </div>
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
      {coordinate && (
        <Section title="Clicked at">
          <div className="font-mono text-[12px]">{formatCoord(coordinate[1])}, {formatCoord(coordinate[0])}</div>
        </Section>
      )}
    </div>
  )
}
