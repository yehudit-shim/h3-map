import { useRef, useState } from 'react'
import { AlertTriangle, Upload } from 'lucide-react'
import { compatibleLayerTypes } from '../../layers/index.js'
import { formatNumber } from '../../lib/format.js'
import { cn } from '../../lib/cn.js'
import { Button } from '../Button.jsx'
import { Field, Select } from '../controls.jsx'
import { Badge, Spinner } from '../feedback.jsx'

const PHASES = { read: 'Reading', parse: 'Parsing', build: 'Building points' }

export function ProgressBar({ progress, onCancel }) {
  const { phase, loaded, total } = progress ?? {}
  const fraction = total > 0 && loaded != null ? Math.min(1, loaded / total) : null
  return (
    <div className="rounded-lg border border-line bg-raised/50 p-3" data-testid="parse-progress" role="status">
      <div className="mb-1.5 flex items-center gap-2 text-[12px]">
        <Spinner />
        <span className="flex-1">
          {PHASES[phase] ?? 'Working'}…{fraction != null && ` ${Math.round(fraction * 100)}%`}
        </span>
        {onCancel && <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
        <div className={cn('h-full rounded-full bg-accent transition-[width]', fraction == null && 'w-1/3 animate-pulse')} style={fraction != null ? { width: `${fraction * 100}%` } : undefined} />
      </div>
      <p className="mt-1.5 text-[11px] text-muted">Parsing runs in a background worker; the map stays usable.</p>
    </div>
  )
}

export function ErrorBox({ children }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/50 bg-danger/10 p-3 text-[12px]" data-testid="parse-error">
      <AlertTriangle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

export function Warnings({ warnings }) {
  if (!warnings?.length) return null
  return (
    <ul className="space-y-1.5" data-testid="parse-warnings">
      {warnings.map((w, i) => (
        <li key={i} className="flex items-start gap-2 rounded-md border border-warn/50 bg-warn/10 p-2 text-[12px]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <span className="min-w-0 break-words">{w}</span>
        </li>
      ))}
    </ul>
  )
}

/** Click-or-drop file chooser. */
export function FilePicker({ accept, label, hint, onFile, disabled }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  return (
    <div
      className={cn('flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors', over ? 'border-accent bg-accent/10' : 'border-line')}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        const file = e.dataTransfer.files?.[0]
        if (file && !disabled) onFile(file)
      }}
    >
      <Upload size={22} className="text-muted" strokeWidth={1.5} aria-hidden="true" />
      <Button variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>Choose file…</Button>
      <div className="text-[11px] text-muted">{hint}</div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        aria-label={label}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onFile(file)
        }}
      />
    </div>
  )
}

export function FieldChips({ fields }) {
  const shown = fields.filter((f) => f.name !== 'id').slice(0, 24)
  if (!shown.length) return <div className="text-[11px] text-muted">No attributes.</div>
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((f) => (
        <span key={f.name} className="rounded border border-line px-1.5 py-px font-mono text-[10px] text-muted">
          {f.name}<span className="opacity-60"> {f.type === 'number' ? '#' : 'a'}</span>
        </span>
      ))}
      {fields.length > shown.length && <span className="text-[10px] text-muted">+{fields.length - shown.length} more</span>}
    </div>
  )
}

/** Summary of a parsed dataset with the layer-type choice and the Add button. */
export function ResultPanel({ result, defaultName, onAdd, children }) {
  const types = compatibleLayerTypes({ geometry: result.geometry })
  const [typeId, setTypeId] = useState(types[0]?.id)
  const [name, setName] = useState(defaultName)
  return (
    <div className="space-y-2.5" data-testid="parse-result">
      <div className="rounded-lg border border-line bg-raised/50 p-3">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="font-medium" data-testid="result-count">{formatNumber(result.featureCount)} features</span>
          <Badge>{result.geometry}</Badge>
          {result.bounds === null && <Badge>no valid extent</Badge>}
        </div>
        <div className="mt-2"><FieldChips fields={result.fields} /></div>
      </div>
      <Warnings warnings={result.warnings} />
      {children}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Layer name" htmlFor="new-layer-name">
          <input id="new-layer-name" value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] outline-none focus-visible:border-accent" />
        </Field>
        <Field label="Layer type" htmlFor="new-layer-type">
          <Select id="new-layer-type" value={typeId} onChange={setTypeId} options={types.map((t) => ({ value: t.id, label: t.label }))} />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="solid" onClick={() => onAdd(typeId, name)} disabled={!typeId} data-testid="add-to-map">Add to map</Button>
      </div>
    </div>
  )
}
