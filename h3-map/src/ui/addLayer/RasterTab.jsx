import { useState } from 'react'
import { getLayerType } from '../../layers/index.js'
import { Button } from '../Button.jsx'
import { Field, Segmented, Select, Slider } from '../controls.jsx'
import { addWebLayer } from '../layerActions.js'

const inputClass = 'h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] outline-none placeholder:text-muted focus-visible:border-accent'

/** XYZ tiles / WMS: no data to parse, only a service description. */
export default function RasterTab({ onDone }) {
  const [typeId, setTypeId] = useState('xyz')
  const type = getLayerType(typeId)
  const [styles, setStyles] = useState({ xyz: getLayerType('xyz').defaults(), wms: getLayerType('wms').defaults() })
  const [names, setNames] = useState({ xyz: '', wms: '' })
  const [opacity, setOpacity] = useState(1)
  const [touched, setTouched] = useState(false)
  const style = styles[typeId]
  const set = (key, value) => setStyles((s) => ({ ...s, [typeId]: { ...s[typeId], [key]: value } }))
  const problem = type.validate(style)

  const submit = (e) => {
    e.preventDefault()
    setTouched(true)
    if (problem) return
    addWebLayer(typeId, { name: names[typeId], style, opacity })
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-1" noValidate>
      <Segmented aria-label="Web layer kind" value={typeId} onChange={(v) => { setTypeId(v); setTouched(false) }} options={[{ value: 'xyz', label: 'XYZ tiles' }, { value: 'wms', label: 'WMS' }]} />
      <Field label="Layer name (optional)" htmlFor="web-name">
        <input id="web-name" className={inputClass} value={names[typeId]} onChange={(e) => setNames((n) => ({ ...n, [typeId]: e.target.value }))} placeholder={type.label} />
      </Field>
      <Field label={typeId === 'xyz' ? 'Tile URL template' : 'WMS service URL'} htmlFor="web-url">
        <input
          id="web-url"
          className={inputClass}
          value={style.url}
          spellCheck={false}
          onChange={(e) => set('url', e.target.value)}
          placeholder={typeId === 'xyz' ? 'https://…/{z}/{x}/{y}.png' : 'https://…/wms'}
          aria-invalid={touched && !!problem}
        />
      </Field>
      {typeId === 'xyz' ? (
        <p className="text-[11px] text-muted">Use {'{z}'}, {'{x}'}, {'{y}'} (or {'{-y}'} for TMS) and optionally {'{s}'} for subdomains.</p>
      ) : (
        <>
          <Field label="WMS layer names (comma separated)" htmlFor="web-layers">
            <input id="web-layers" className={inputClass} value={style.layers} spellCheck={false} onChange={(e) => set('layers', e.target.value)} placeholder="roads,water" />
          </Field>
          <Field label="Request CRS" htmlFor="web-srs">
            <Select id="web-srs" value={style.srs} onChange={(v) => set('srs', v)} options={type.controls.find((c) => c.key === 'srs').options} />
          </Field>
        </>
      )}
      <Field label="Attribution" htmlFor="web-attribution">
        <input id="web-attribution" className={inputClass} value={style.attribution} onChange={(e) => set('attribution', e.target.value)} placeholder="© Data provider" />
      </Field>
      <Field label="Opacity" hint={`${Math.round(opacity * 100)}%`} htmlFor="web-opacity">
        <Slider id="web-opacity" value={opacity} min={0.1} max={1} step={0.05} onChange={setOpacity} />
      </Field>
      {touched && problem && <div className="text-[12px] text-danger" role="alert">{problem}</div>}
      <p className="text-[11px] text-muted">Respect the provider's usage policy and give credit. Tile and image failures are reported as a notice.</p>
      <div className="flex justify-end pt-1">
        <Button type="submit" variant="solid" data-testid="add-web-layer">Add to map</Button>
      </div>
    </form>
  )
}
