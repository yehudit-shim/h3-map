import { useState } from 'react'
import { Database, FilePlus2, Plus } from 'lucide-react'
import { compatibleLayerTypes } from '../layers/index.js'
import { dataSources } from '../data/sources.js'
import { useDataStore } from '../state/dataStore.js'
import { useLayersStore } from '../state/layersStore.js'
import { useUiStore } from '../state/uiStore.js'
import { zoomToBounds } from '../map/mapActions.js'
import { Button } from './Button.jsx'
import { Field, Select } from './controls.jsx'
import { Badge, Section, Spinner } from './feedback.jsx'
import { LayerTypeIcon } from './layerIcons.jsx'

export function SourceCard({ source, onAdded }) {
  const types = compatibleLayerTypes(source)
  const [typeId, setTypeId] = useState(types[0]?.id)
  const entry = useDataStore((s) => s.entries[source.id])

  const add = async () => {
    const layer = useLayersStore.getState().addLayer(typeId, source.id)
    useUiStore.getState().openLeftTab('layers')
    useDataStore.getState().ensure(source.id)
    // zoom to the data once it is available (cached after the first load)
    const wait = () => {
      const e = useDataStore.getState().entries[source.id]
      if (e?.status === 'ready') zoomToBounds(e.bounds)
      else if (e?.status !== 'error') setTimeout(wait, 80)
    }
    wait()
    onAdded?.(layer)
    return layer
  }

  return (
    <li className="rounded-lg border border-line bg-raised/50 p-3" data-testid={`source-${source.id}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{source.name}</div>
          <div className="mt-0.5 text-[12px] leading-snug text-muted">{source.description}</div>
        </div>
        <Badge>{source.geometry}</Badge>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {source.fields.filter((f) => f.name !== 'id').map((f) => (
          <span key={f.name} className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-muted">
            {f.name}<span className="opacity-60"> {f.type === 'number' ? '#' : 'a'}</span>
          </span>
        ))}
      </div>
      <div className="mt-2.5 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Field label="Layer type">
            <Select aria-label={`Layer type for ${source.name}`} value={typeId} onChange={setTypeId} options={types.map((t) => ({ value: t.id, label: t.label }))} />
          </Field>
        </div>
        <Button variant="solid" className="mb-1.5 shrink-0" onClick={add} aria-label={`Add ${source.name} to map`}>
          {entry?.status === 'loading' ? <Spinner /> : <Plus size={14} />} Add
        </Button>
      </div>
    </li>
  )
}

export default function DataPanel() {
  const samples = dataSources.filter((s) => s.kind === 'sample')
  return (
    <div>
      <Section title="Your data">
        <p className="mb-2 text-[12px] leading-snug text-muted">Load a GeoJSON or CSV file or URL, or add XYZ / WMS web layers. You can also drop a file on the map.</p>
        <Button variant="solid" onClick={() => useUiStore.getState().openAddLayer({ tab: 'geojson' })} data-testid="open-add-layer">
          <FilePlus2 size={14} aria-hidden="true" /> Add layer…
        </Button>
      </Section>
      <Section title="Sample datasets" action={<Database size={13} className="text-muted" aria-hidden="true" />}>
        <p className="mb-2 text-[12px] leading-snug text-muted">
          Synthetic data around Paris, generated in the browser. PostgreSQL/PostGIS tables will appear here in a later phase.
        </p>
        <ul className="space-y-2">
          {samples.map((s) => (
            <SourceCard key={s.id} source={s} />
          ))}
        </ul>
      </Section>
      <Section title="Layer types">
        <ul className="space-y-1">
          {[...new Map(dataSources.flatMap((s) => compatibleLayerTypes(s)).map((t) => [t.id, t])).values()].map((t) => (
            <li key={t.id} className="flex items-start gap-2 py-0.5 text-[12px]">
              <LayerTypeIcon icon={t.icon} className="mt-0.5 shrink-0 text-accent" />
              <span><span className="font-medium">{t.label}</span> <span className="text-muted">{t.description}</span></span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  )
}
