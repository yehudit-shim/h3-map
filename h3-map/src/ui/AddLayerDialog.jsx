import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { dataSources } from '../data/sources.js'
import { cn } from '../lib/cn.js'
import { useUiStore } from '../state/uiStore.js'
import { IconButton } from './Button.jsx'
import { SourceCard } from './DataPanel.jsx'
import CsvTab from './addLayer/CsvTab.jsx'
import GeoJsonTab from './addLayer/GeoJsonTab.jsx'
import MvtTab from './addLayer/MvtTab.jsx'
import RasterTab from './addLayer/RasterTab.jsx'

const TABS = [
  { id: 'sample', label: 'Sample data' },
  { id: 'geojson', label: 'GeoJSON' },
  { id: 'csv', label: 'CSV' },
  { id: 'web', label: 'XYZ / WMS' },
  { id: 'mvt', label: 'MVT URL' },
]

function SampleTab({ onDone }) {
  const samples = dataSources.filter((s) => s.kind === 'sample')
  return (
    <ul className="space-y-2">
      {samples.map((s) => <SourceCard key={s.id} source={s} onAdded={onDone} />)}
    </ul>
  )
}

/** "Add layer" dialog: sample data, GeoJSON file/URL, CSV points, XYZ/WMS web layers. */
export default function AddLayerDialog() {
  const dialog = useUiStore((s) => s.addLayerDialog)
  const open = useUiStore((s) => s.openAddLayer)
  const close = useUiStore((s) => s.closeAddLayer)
  const closeRef = useRef(null)
  useEffect(() => {
    if (dialog) closeRef.current?.focus()
  }, [!!dialog]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!dialog) return null
  const { tab, file } = dialog

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-layer-title"
        className="flex max-h-[88vh] w-[min(560px,100%)] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-float"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <h2 id="add-layer-title" className="flex-1 text-[14px] font-semibold">Add layer</h2>
          <IconButton ref={closeRef} label="Close add layer" icon={X} size={15} className="h-7 w-7" onClick={close} />
        </div>
        <div role="tablist" aria-label="Layer source" className="flex gap-0.5 border-b border-line px-3 pt-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`add-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="add-layer-panel"
              onClick={() => tab !== t.id && open({ tab: t.id })}
              className={cn('cursor-pointer border-b-2 px-3 py-1.5 text-[12px] transition-colors', tab === t.id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div id="add-layer-panel" role="tabpanel" aria-labelledby={`add-tab-${tab}`} className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'sample' && <SampleTab onDone={close} />}
          {tab === 'geojson' && <GeoJsonTab key={file?.name ?? 'g'} initialFile={file} onDone={close} />}
          {tab === 'csv' && <CsvTab key={file?.name ?? 'c'} initialFile={file} onDone={close} />}
          {tab === 'web' && <RasterTab onDone={close} />}
          {tab === 'mvt' && <MvtTab onDone={close} />}
        </div>
      </div>
    </div>
  )
}
