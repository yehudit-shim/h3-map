import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Copy, Crosshair, Eye, EyeOff, Layers, Pencil, Trash2 } from 'lucide-react'
import { getLayerType } from '../layers/index.js'
import { getSource } from '../data/sources.js'
import { cn } from '../lib/cn.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useRuntimeStore } from '../state/runtimeStore.js'
import { zoomToBounds } from '../map/mapActions.js'
import { IconButton } from './Button.jsx'
import { Slider } from './controls.jsx'
import { EmptyState, Spinner } from './feedback.jsx'
import { LayerTypeIcon } from './layerIcons.jsx'

function RenameInput({ initial, onDone }) {
  const ref = useRef(null)
  useEffect(() => ref.current?.select(), [])
  const [value, setValue] = useState(initial)
  const commit = () => onDone(value)
  return (
    <input
      ref={ref}
      aria-label="Layer name"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onDone(initial)
      }}
      className="h-6 w-full rounded border border-accent bg-raised px-1.5 text-[13px] outline-none"
    />
  )
}

function LayerRow({ layer, index, count }) {
  const store = useLayersStore.getState
  const active = useLayersStore((s) => s.activeId === layer.id)
  const entry = useDataStore((s) => s.entries[layer.sourceId])
  const info = useRuntimeStore((s) => s.info[layer.id])
  const [renaming, setRenaming] = useState(false)
  const type = getLayerType(layer.type)
  const source = getSource(layer.sourceId)
  const failed = entry?.status === 'error'

  return (
    <li
      className={cn('group rounded-md border px-2 py-1.5 transition-colors', active ? 'border-accent/60 bg-hover' : 'border-transparent hover:bg-hover/60')}
      data-testid={`layer-row-${layer.id}`}
    >
      <div className="flex items-center gap-1.5">
        <IconButton
          label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
          icon={layer.visible ? Eye : EyeOff}
          className="h-7 w-7"
          active={undefined}
          onClick={() => store().toggleVisible(layer.id)}
        />
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left" onClick={() => store().setActive(layer.id)} aria-current={active}>
          <LayerTypeIcon icon={type?.icon} className={cn('shrink-0', layer.visible ? 'text-accent' : 'text-muted')} />
          {renaming ? (
            <RenameInput
              initial={layer.name}
              onDone={(v) => {
                store().renameLayer(layer.id, v)
                setRenaming(false)
              }}
            />
          ) : (
            <span className={cn('truncate text-[13px]', !layer.visible && 'text-muted')} onDoubleClick={() => setRenaming(true)}>{layer.name}</span>
          )}
        </button>
        {entry?.status === 'loading' && <Spinner label={`Loading ${layer.name}`} />}
        {failed && <AlertTriangle size={14} className="shrink-0 text-danger" aria-label="Failed to load" />}
      </div>

      {active && (
        <div className="mt-1.5 space-y-1.5 pl-9">
          <div className="text-[11px] text-muted">
            {type?.label} · {source?.name ?? layer.sourceId}
            {entry?.featureCount != null && ` · ${entry.featureCount.toLocaleString('en-US')} features`}
            {info?.resolution != null && ` · H3 res ${info.resolution} (${info.cellCount.toLocaleString('en-US')} cells)`}
          </div>
          {failed && (
            <div className="text-[12px] text-danger">
              {entry.error}{' '}
              <button type="button" className="cursor-pointer underline" onClick={() => useDataStore.getState().retry(layer.sourceId)}>Retry</button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="w-12 text-[11px] text-muted">Opacity</span>
            <Slider aria-label={`Opacity of ${layer.name}`} value={layer.opacity} min={0} max={1} step={0.05} onChange={(v) => store().setOpacity(layer.id, v)} />
            <span className="w-8 text-right font-mono text-[11px] text-muted">{Math.round(layer.opacity * 100)}%</span>
          </div>
          <div className="-ml-1.5 flex items-center gap-0.5">
            <IconButton label="Move up (draw above)" icon={ArrowUp} size={14} className="h-7 w-7" disabled={index === 0} onClick={() => store().moveLayer(layer.id, -1)} />
            <IconButton label="Move down (draw below)" icon={ArrowDown} size={14} className="h-7 w-7" disabled={index === count - 1} onClick={() => store().moveLayer(layer.id, 1)} />
            <IconButton label="Zoom to layer" icon={Crosshair} size={14} className="h-7 w-7" disabled={!entry?.bounds} onClick={() => zoomToBounds(entry.bounds)} />
            <IconButton label="Rename layer" icon={Pencil} size={14} className="h-7 w-7" onClick={() => setRenaming(true)} />
            <IconButton label="Duplicate layer" icon={Copy} size={14} className="h-7 w-7" onClick={() => store().duplicateLayer(layer.id)} />
            <IconButton label="Remove layer" icon={Trash2} size={14} className="ml-auto h-7 w-7 hover:text-danger" onClick={() => store().removeLayer(layer.id)} />
          </div>
        </div>
      )}
    </li>
  )
}

export default function LayerManager() {
  const layers = useLayersStore((s) => s.layers)
  if (!layers.length) {
    return <EmptyState icon={Layers} title="No layers yet">Open the Data tab and add a layer from a sample dataset.</EmptyState>
  }
  return (
    <ul className="space-y-0.5 p-2" aria-label="Layers (top of list is drawn on top)">
      {layers.map((l, i) => (
        <LayerRow key={l.id} layer={l} index={i} count={layers.length} />
      ))}
    </ul>
  )
}
