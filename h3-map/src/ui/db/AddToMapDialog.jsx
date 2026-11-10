import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Plus, RefreshCw } from 'lucide-react'
import { attributeColumns, buildSourceInput, defaultColumns, defaultLayerType, planStrategies } from '../../data/pgPlan.js'
import { dataKindOf } from '../../data/pgSources.js'
import { compatibleLayerTypes } from '../../layers/index.js'
import { formatNumber } from '../../lib/format.js'
import { useAuthStore } from '../../state/authStore.js'
import { tableKey, useConnectionsStore } from '../../state/connectionsStore.js'
import { useUiStore } from '../../state/uiStore.js'
import { Button } from '../Button.jsx'
import Dialog from '../Dialog.jsx'
import { Badge, Spinner } from '../feedback.jsx'
import { addDatabaseLayer } from '../layerActions.js'
import ProfileWarnings from './ProfileWarnings.jsx'

const inputCls = 'h-8 w-full rounded-md border border-line bg-raised px-2 text-[13px] text-fg outline-none focus-visible:border-accent'
const AGGS = ['avg', 'sum', 'min', 'max', 'median', 'count']

function Row({ label, htmlFor, children }) {
  return (
    <div className="py-1.5">
      <label htmlFor={htmlFor} className="mb-1 block text-[12px] text-muted">{label}</label>
      {children}
    </div>
  )
}

function Form({ target, profile, onClose }) {
  const limits = useAuthStore((s) => s.config?.limits)
  const plan = useMemo(() => planStrategies(profile, limits), [profile, limits])
  const [strategy, setStrategy] = useState(plan.default)
  const [name, setName] = useState(`${profile.schema}.${profile.table}`)
  const [geometryColumn, setGeometryColumn] = useState(profile.geometry?.[0]?.column ?? '')
  const [h3Column, setH3Column] = useState(profile.h3?.[0]?.column ?? '')
  const [valueColumn, setValueColumn] = useState('')
  const [agg, setAgg] = useState('avg')
  const [columns, setColumns] = useState(() => new Set(defaultColumns(profile)))
  const [typeChoice, setTypeChoice] = useState(null)

  const isH3 = strategy === 'h3cells' || strategy === 'h3aggregate'
  const attrs = attributeColumns(profile)
  const numeric = attrs.filter((f) => f.type === 'number')
  const input = buildSourceInput({ connectionId: target.connectionId, profile, strategy, geometryColumn, h3Column, valueColumn, agg, columns: [...columns], name })
  const types = compatibleLayerTypes({ dataKind: dataKindOf(strategy), geometry: input.geometry })
  const typeId = types.some((t) => t.id === typeChoice) ? typeChoice : (types.find((t) => t.id === defaultLayerType(strategy, input.geometry)) ?? types[0])?.id
  const option = plan.options.find((o) => o.strategy === strategy)
  const rows = profile.estimatedRows

  if (!plan.options.length) {
    return (
      <div className="p-4 text-[13px]" data-testid="not-mappable">
        <p>This {profile.kind} has no geometry column and no H3 column, so it cannot be drawn on the map.</p>
        <p className="mt-1 text-[12px] text-muted">You can still browse its rows from the table details.</p>
        <div className="mt-4 flex justify-end"><Button variant="outline" onClick={onClose}>Close</Button></div>
      </div>
    )
  }

  const submit = (e) => {
    e.preventDefault()
    if (!typeId) return
    addDatabaseLayer({ input, typeId, name })
    onClose()
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-label="Add table to map">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
          <span className="font-mono text-fg">{profile.schema}.{profile.table}</span>
          {rows != null && <span>~{formatNumber(rows)} rows</span>}
          {profile.geometry?.[0] && <Badge>{profile.geometry[0].type} · {profile.geometry[0].srid}</Badge>}
          {profile.h3?.length > 0 && <Badge tone="accent">H3</Badge>}
        </div>

        <ProfileWarnings warnings={profile.warnings} compact />

        <fieldset className="mt-3">
          <legend className="mb-1 text-[12px] text-muted">Loading strategy</legend>
          <div className="space-y-1.5" role="radiogroup" aria-label="Loading strategy">
            {plan.options.map((o) => (
              <label key={o.strategy} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2 ${strategy === o.strategy ? 'border-accent bg-accent/10' : 'border-line hover:bg-hover'}`}>
                <input type="radio" name="strategy" value={o.strategy} checked={strategy === o.strategy} onChange={() => setStrategy(o.strategy)} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">{o.label}{o.recommended && <Badge tone="accent">Recommended</Badge>}</span>
                  <span className="block text-[11px] leading-snug text-muted">{o.description}</span>
                </span>
              </label>
            ))}
          </div>
          {option?.warning && <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-warn" role="alert"><AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{option.warning}</p>}
        </fieldset>

        <Row label="Layer name" htmlFor="atm-name"><input id="atm-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Row>

        {strategy !== 'h3cells' && profile.geometry?.length > 1 && (
          <Row label="Geometry column" htmlFor="atm-geom">
            <select id="atm-geom" className={inputCls} value={geometryColumn} onChange={(e) => setGeometryColumn(e.target.value)}>
              {profile.geometry.map((g) => <option key={g.column} value={g.column}>{g.column} ({g.type}, {g.srid})</option>)}
            </select>
          </Row>
        )}
        {strategy === 'h3cells' && profile.h3?.length > 1 && (
          <Row label="H3 column" htmlFor="atm-h3">
            <select id="atm-h3" className={inputCls} value={h3Column} onChange={(e) => setH3Column(e.target.value)}>
              {profile.h3.map((c) => <option key={c.column} value={c.column}>{c.column} (res {c.resolutions?.join(', ') || '?'})</option>)}
            </select>
          </Row>
        )}

        {isH3 ? (
          <div className="grid grid-cols-2 gap-2">
            <Row label="Value column" htmlFor="atm-value">
              <select id="atm-value" className={inputCls} value={valueColumn} onChange={(e) => setValueColumn(e.target.value)}>
                <option value="">Count of rows</option>
                {numeric.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
              </select>
            </Row>
            <Row label="Aggregate" htmlFor="atm-agg">
              <select id="atm-agg" className={inputCls} value={agg} disabled={!valueColumn} onChange={(e) => setAgg(e.target.value)}>
                {AGGS.filter((a) => a !== 'count').map((a) => <option key={a}>{a}</option>)}
              </select>
            </Row>
          </div>
        ) : (
          <fieldset className="mt-1">
            <legend className="mb-1 text-[12px] text-muted">Attribute columns to fetch ({columns.size} of {attrs.length})</legend>
            <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border border-line p-1.5">
              {attrs.length === 0 && <div className="text-[12px] text-muted">No attribute columns.</div>}
              {attrs.map((f) => (
                <label key={f.name} className="flex cursor-pointer items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={columns.has(f.name)}
                    onChange={(e) => setColumns((c) => { const n = new Set(c); if (e.target.checked) n.add(f.name); else n.delete(f.name); return n })}
                  />
                  <span className="truncate">{f.name}</span><span className="font-mono text-[10px] text-muted">{f.type === 'number' ? '#' : 'a'}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted">Fewer columns load faster. Geometry is always included.</p>
          </fieldset>
        )}

        {types.length > 1 && (
          <Row label="Layer type" htmlFor="atm-type">
            <select id="atm-type" className={inputCls} value={typeId} onChange={(e) => setTypeChoice(e.target.value)}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Row>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="solid" disabled={!typeId} data-testid="confirm-add-to-map"><Plus size={14} aria-hidden="true" /> Add to map</Button>
      </div>
    </form>
  )
}

/** "Add to map" dialog (docs/UI_UX_DESIGN.md section 5): strategy preselected from the profile's recommendedStrategy. */
export default function AddToMapDialog() {
  const target = useUiStore((s) => s.addToMap)
  const close = useUiStore((s) => s.closeAddToMap)
  const key = target ? tableKey(target.connectionId, target.schema, target.table) : null
  const entry = useConnectionsStore((s) => (key ? s.profiles[key] : undefined))
  useEffect(() => {
    if (target) useConnectionsStore.getState().loadProfile(target.connectionId, target.schema, target.table)
  }, [target])
  if (!target) return null
  const ready = entry?.status === 'ready' && entry.data
  return (
    <Dialog title="Add table to map" titleId="atm-title" onClose={close} width={500} testId="add-table-dialog">
      {ready ? (
        <Form key={key} target={target} profile={entry.data} onClose={close} />
      ) : entry?.status === 'error' ? (
        <div className="p-4" role="alert">
          <p className="text-[13px] text-danger">Could not read the table: {entry.error.message}</p>
          <div className="mt-3 flex gap-2">
            {entry.error.retryable && <Button variant="outline" onClick={() => useConnectionsStore.getState().loadProfile(target.connectionId, target.schema, target.table, true)}><RefreshCw size={13} aria-hidden="true" /> Retry</Button>}
            <Button variant="ghost" onClick={close}>Close</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 p-6 text-[13px] text-muted"><Spinner label="Reading table profile" /> Reading the table profile…</div>
      )}
    </Dialog>
  )
}
