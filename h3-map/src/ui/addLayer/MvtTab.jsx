import { useState } from 'react'
import { checkTileUrl } from '../../data/pgSources.js'
import { Button } from '../Button.jsx'
import { Field, Select } from '../controls.jsx'
import { addMvtUrlLayer } from '../layerActions.js'

const inputClass = 'h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] outline-none placeholder:text-muted focus-visible:border-accent'

/** A public vector-tile service (`{z}/{x}/{y}` URL). No sign-in and no token: requests go straight to that URL. */
export default function MvtTab({ onDone }) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [sourceLayer, setSourceLayer] = useState('')
  const [minzoom, setMinzoom] = useState('0')
  const [maxzoom, setMaxzoom] = useState('14')
  const [geometry, setGeometry] = useState('mixed')
  const [touched, setTouched] = useState(false)
  const problem = checkTileUrl(url)

  const submit = (e) => {
    e.preventDefault()
    setTouched(true)
    if (problem) return
    addMvtUrlLayer({ name, url, sourceLayer, minzoom, maxzoom, geometry })
    onDone()
  }

  return (
    <form onSubmit={submit} className="space-y-1" noValidate>
      <Field label="Tile URL template" htmlFor="mvt-url">
        <input id="mvt-url" className={inputClass} value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/{z}/{x}/{y}.pbf" aria-invalid={touched && !!problem} />
      </Field>
      <p className="text-[11px] text-muted">The URL must contain {'{z}'}, {'{x}'} and {'{y}'}. The server must allow cross-origin requests (CORS).</p>
      <Field label="Layer name (optional)" htmlFor="mvt-name"><input id="mvt-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Vector tiles" /></Field>
      <Field label="Source layer (optional)" htmlFor="mvt-source-layer"><input id="mvt-source-layer" className={inputClass} value={sourceLayer} spellCheck={false} onChange={(e) => setSourceLayer(e.target.value)} placeholder="all layers" /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Min zoom" htmlFor="mvt-min"><input id="mvt-min" type="number" min="0" max="24" className={inputClass} value={minzoom} onChange={(e) => setMinzoom(e.target.value)} /></Field>
        <Field label="Max zoom" htmlFor="mvt-max"><input id="mvt-max" type="number" min="0" max="24" className={inputClass} value={maxzoom} onChange={(e) => setMaxzoom(e.target.value)} /></Field>
      </div>
      <Field label="Geometry" htmlFor="mvt-geom">
        <Select id="mvt-geom" value={geometry} onChange={setGeometry} options={[{ value: 'mixed', label: 'Mixed / unknown' }, { value: 'point', label: 'Points' }, { value: 'line', label: 'Lines' }, { value: 'polygon', label: 'Polygons' }]} />
      </Field>
      {touched && problem && <div className="text-[12px] text-danger" role="alert">{problem}</div>}
      <div className="flex justify-end pt-1"><Button type="submit" variant="solid" data-testid="add-mvt-layer">Add to map</Button></div>
    </form>
  )
}
