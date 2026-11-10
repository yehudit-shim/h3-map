import { SlidersHorizontal } from 'lucide-react'
import { getLayerType } from '../layers/index.js'
import { getSource } from '../data/sources.js'
import { valueFieldsOf } from '../layers/common.js'
import { H3_MAX_RES, resolutionInfo } from '../h3/h3Utils.js'
import { formatNumber } from '../lib/format.js'
import { useLayersStore } from '../state/layersStore.js'
import { useRuntimeStore } from '../state/runtimeStore.js'
import { ColorInput, Field, RampSelect, Segmented, Select, Slider, Switch } from './controls.jsx'
import { EmptyState, Section } from './feedback.jsx'

/** One control rendered from a layer type's control descriptor. */
export function ControlRow({ control, layer, source }) {
  const value = layer.style[control.key]
  const set = (v) => useLayersStore.getState().updateStyle(layer.id, { [control.key]: v })
  const id = `${layer.id}-${control.key}`
  switch (control.type) {
    case 'color':
      return <Field label={control.label} htmlFor={id}><ColorInput label={control.label} value={value} onChange={set} /></Field>
    case 'range':
      return (
        <Field label={control.label} hint={control.step < 1 ? Number(value).toFixed(2) : String(value)} htmlFor={id}>
          <Slider id={id} value={value} min={control.min} max={control.max} step={control.step} onChange={set} />
        </Field>
      )
    case 'switch':
      return (
        <Field label={control.label} inline htmlFor={id}>
          <Switch label={control.label} checked={!!value} onChange={set} />
        </Field>
      )
    case 'select':
      return <Field label={control.label} htmlFor={id}><Select id={id} value={value} onChange={set} options={control.options} /></Field>
    case 'segmented':
      return <Field label={control.label}><Segmented aria-label={control.label} value={value} onChange={set} options={control.options} /></Field>
    case 'ramp':
      return <Field label={control.label} htmlFor={id}><RampSelect id={id} value={value} onChange={set} reverse={layer.style.reverse} /></Field>
    case 'field': {
      const fields = valueFieldsOf(source)
      const options = [...(control.required ? [] : [{ value: '', label: control.noneLabel ?? 'None' }]), ...fields.map((f) => ({ value: f.name, label: f.name }))]
      return (
        <Field label={control.label} htmlFor={id}>
          <Select id={id} value={value ?? ''} onChange={(v) => set(v === '' ? null : v)} options={options} />
        </Field>
      )
    }
    default:
      return null
  }
}

/** H3 resolution readout shown above the controls of an H3 layer. */
export function H3Readout({ layer }) {
  const info = useRuntimeStore((s) => s.info[layer.id])
  if (!info) return null
  const { edgeKm, areaKm2 } = resolutionInfo(info.resolution)
  return (
    <div className="mb-1 rounded-md border border-line bg-raised/60 p-2 text-[12px]" data-testid="h3-readout">
      <div className="flex justify-between"><span className="text-muted">Showing resolution</span><span className="font-mono font-semibold text-accent">{info.resolution} / {H3_MAX_RES}</span></div>
      <div className="flex justify-between"><span className="text-muted">Avg edge · area</span><span className="font-mono">{edgeKm < 1 ? `${formatNumber(edgeKm * 1000)} m` : `${formatNumber(edgeKm)} km`} · {formatNumber(areaKm2)} km²</span></div>
      <div className="flex justify-between"><span className="text-muted">Cells</span><span className="font-mono">{formatNumber(info.cellCount)}</span></div>
    </div>
  )
}

export default function StylePanel() {
  const layer = useLayersStore((s) => s.layers.find((l) => l.id === s.activeId))
  if (!layer) {
    return <EmptyState icon={SlidersHorizontal} title="No layer selected">Select a layer in the Layers tab to edit its style.</EmptyState>
  }
  const type = getLayerType(layer.type)
  const source = getSource(layer.sourceId)
  const groups = type.styleGroups ?? ['data', 'appearance']
  const titles = { data: 'Data', appearance: 'Appearance' }
  return (
    <div>
      <div className="border-b border-line px-3 py-2.5">
        <div className="truncate text-[13px] font-semibold">{layer.name}</div>
        <div className="text-[11px] text-muted">{type.label} · {source?.name}</div>
      </div>
      {groups.map((g) => {
        const controls = type.controls.filter((c) => c.group === g && (!c.showIf || c.showIf(layer.style, source)))
        if (!controls.length) return null
        return (
          <Section key={g} title={titles[g]}>
            {layer.type === 'h3' && g === 'data' && <H3Readout layer={layer} />}
            {controls.map((c) => (
              <ControlRow key={c.key} control={c} layer={layer} source={source} />
            ))}
          </Section>
        )
      })}
    </div>
  )
}
